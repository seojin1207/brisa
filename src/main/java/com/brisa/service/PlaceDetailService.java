package com.brisa.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

@Service
public class PlaceDetailService {

    private static final String GOOGLE_TEXT_SEARCH_URL =
            "https://places.googleapis.com/v1/places:searchText";

    private static final String GOOGLE_PHOTO_BASE_URL =
            "https://places.googleapis.com/v1/";

    private static final String FIELD_MASK = String.join(",",
            "places.id",
            "places.displayName",
            "places.formattedAddress",
            "places.location",
            "places.rating",
            "places.userRatingCount",
            "places.currentOpeningHours",
            "places.regularOpeningHours",
            "places.reviews",
            "places.photos",
            "places.websiteUri",
            "places.nationalPhoneNumber",
            "places.googleMapsUri",
            "places.priceLevel",
            "places.editorialSummary"
    );

    private static final Pattern PHOTO_NAME_PATTERN =
            Pattern.compile("^places/[A-Za-z0-9_-]+/photos/[A-Za-z0-9_-]+$");

    private static final long CACHE_TTL_MILLIS = 10 * 60 * 1000L; // 10분 캐시
    private static final int MAX_CACHE_ENTRIES = 200;

    private final String googlePlacesApiKey;
    private final RestTemplate restTemplate;
    private final Map<String, CacheEntry> cache = new ConcurrentHashMap<>();

    @Autowired
    public PlaceDetailService(
            @Value("${google.places.api-key:}") String googlePlacesApiKey) {
        this.googlePlacesApiKey = googlePlacesApiKey == null ? "" : googlePlacesApiKey.trim();
        this.restTemplate = createRestTemplate();
    }

    // 테스트 주입용 생성자
    PlaceDetailService(String googlePlacesApiKey, RestTemplate restTemplate) {
        this.googlePlacesApiKey = googlePlacesApiKey == null ? "" : googlePlacesApiKey.trim();
        this.restTemplate = restTemplate;
    }

    private RestTemplate createRestTemplate() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(4000);
        factory.setReadTimeout(6000);
        return new RestTemplate(factory);
    }

    public boolean isGoogleApiKeyConfigured() {
        return !googlePlacesApiKey.isEmpty()
                && !googlePlacesApiKey.startsWith("YOUR_");
    }

    /**
     * 카카오 로컬 API에 없는 추가 상세 정보(평점, 영업시간, 리뷰, 사진, 웹사이트 등)를
     * Google Places API (New)로 조회합니다.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> getPlaceExtraDetail(
            String name,
            double lat,
            double lng,
            String address,
            String kakaoPlaceId) {

        if (name == null || name.trim().isEmpty()) {
            return buildStatusResponse("INVALID_REQUEST", "KAKAO_ONLY", "장소명이 비어 있습니다.");
        }

        if (!isGoogleApiKeyConfigured()) {
            return buildStatusResponse(
                    "API_KEY_NOT_CONFIGURED",
                    "KAKAO_ONLY",
                    "Google Places API 키가 설정되지 않아 카카오 기본 정보만 표시합니다."
            );
        }

        String cacheKey = buildCacheKey(name, lat, lng, kakaoPlaceId);
        CacheEntry cached = cache.get(cacheKey);
        if (cached != null && !cached.isExpired()) {
            return cached.data;
        }

        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.set("X-Goog-Api-Key", googlePlacesApiKey);
            headers.set("X-Goog-FieldMask", FIELD_MASK);

            String queryText = buildSearchQuery(name, address);

            Map<String, Object> center = new HashMap<>();
            center.put("latitude", lat);
            center.put("longitude", lng);

            Map<String, Object> circle = new HashMap<>();
            circle.put("center", center);
            circle.put("radius", 500.0);

            Map<String, Object> locationBias = new HashMap<>();
            locationBias.put("circle", circle);

            Map<String, Object> body = new HashMap<>();
            body.put("textQuery", queryText);
            body.put("languageCode", "ko");
            body.put("regionCode", "KR");
            body.put("maxResultCount", 3);
            body.put("locationBias", locationBias);

            ResponseEntity<Map> response = restTemplate.exchange(
                    GOOGLE_TEXT_SEARCH_URL,
                    HttpMethod.POST,
                    new HttpEntity<>(body, headers),
                    Map.class
            );

            Map<String, Object> responseBody = response.getBody();
            if (responseBody == null || !(responseBody.get("places") instanceof List<?> placesRaw) || placesRaw.isEmpty()) {
                Map<String, Object> notFound = buildStatusResponse(
                        "NOT_FOUND",
                        "GOOGLE_PLACES",
                        "추가 상세 정보(영업시간/평점/리뷰)를 찾지 못했습니다."
                );
                putCache(cacheKey, notFound);
                return notFound;
            }

            List<Map<String, Object>> candidates = (List<Map<String, Object>>) placesRaw;
            Map<String, Object> bestMatch = selectBestCandidate(candidates, lat, lng);

            if (bestMatch == null) {
                Map<String, Object> notFound = buildStatusResponse(
                        "NOT_FOUND",
                        "GOOGLE_PLACES",
                        "인근 일치 장소의 추가 상세 정보를 찾지 못했습니다."
                );
                putCache(cacheKey, notFound);
                return notFound;
            }

            Map<String, Object> result = normalizeGooglePlace(bestMatch);
            putCache(cacheKey, result);
            return result;

        } catch (Exception e) {
            return buildStatusResponse(
                    "ERROR",
                    "GOOGLE_PLACES",
                    "외부 상세 정보 조회 중 일시적인 오류가 발생했습니다."
            );
        }
    }

    /**
     * Google Places 사진 프록시 (API 키를 프론트엔드에 노출하지 않기 위해 백엔드에서 중계)
     */
    public ResponseEntity<byte[]> fetchPlacePhoto(String photoName, int maxWidthPx) {
        if (!isGoogleApiKeyConfigured()) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        }
        if (photoName == null || !PHOTO_NAME_PATTERN.matcher(photoName).matches()) {
            return ResponseEntity.badRequest().build();
        }

        int clampedWidth = Math.max(100, Math.min(maxWidthPx, 1200));

        try {
            String url = UriComponentsBuilder
                    .fromHttpUrl(GOOGLE_PHOTO_BASE_URL + photoName + "/media")
                    .queryParam("maxWidthPx", clampedWidth)
                    .queryParam("key", googlePlacesApiKey)
                    .build(true)
                    .toUriString();

            ResponseEntity<byte[]> upstream = restTemplate.exchange(
                    url,
                    HttpMethod.GET,
                    HttpEntity.EMPTY,
                    byte[].class
            );

            if (!upstream.getStatusCode().is2xxSuccessful() || upstream.getBody() == null) {
                return ResponseEntity.notFound().build();
            }

            MediaType contentType = upstream.getHeaders().getContentType();
            if (contentType == null) {
                contentType = MediaType.IMAGE_JPEG;
            }

            return ResponseEntity.ok()
                    .contentType(contentType)
                    .cacheControl(CacheControl.maxAge(java.time.Duration.ofHours(1)))
                    .body(upstream.getBody());

        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY).build();
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> selectBestCandidate(
            List<Map<String, Object>> candidates,
            double targetLat,
            double targetLng) {

        Map<String, Object> closest = null;
        double minDistMeters = Double.MAX_VALUE;

        for (Map<String, Object> candidate : candidates) {
            Object locObj = candidate.get("location");
            if (locObj instanceof Map<?, ?> locMap) {
                Object latObj = locMap.get("latitude");
                Object lngObj = locMap.get("longitude");
                if (latObj instanceof Number && lngObj instanceof Number) {
                    double distMeters = calculateHaversineMeters(
                            targetLat, targetLng,
                            ((Number) latObj).doubleValue(),
                            ((Number) lngObj).doubleValue()
                    );
                    if (distMeters < minDistMeters) {
                        minDistMeters = distMeters;
                        closest = candidate;
                    }
                }
            }
        }

        // 반경 1km 이내에 일치 후보가 있으면 반환, 좌표가 없던 경우 첫 번째 후보 사용
        if (closest != null && minDistMeters <= 1000.0) {
            return closest;
        }
        return (closest == null && !candidates.isEmpty()) ? candidates.get(0) : null;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> normalizeGooglePlace(Map<String, Object> place) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("status", "OK");
        result.put("source", "GOOGLE_PLACES");

        if (place.get("rating") instanceof Number ratingNum) {
            result.put("rating", ratingNum.doubleValue());
        }
        if (place.get("userRatingCount") instanceof Number countNum) {
            result.put("userRatingCount", countNum.intValue());
        }

        // 영업시간 파싱 (currentOpeningHours 우선, 없으면 regularOpeningHours)
        Map<String, Object> openingHours = null;
        if (place.get("currentOpeningHours") instanceof Map<?, ?>) {
            openingHours = (Map<String, Object>) place.get("currentOpeningHours");
        } else if (place.get("regularOpeningHours") instanceof Map<?, ?>) {
            openingHours = (Map<String, Object>) place.get("regularOpeningHours");
        }

        if (openingHours != null) {
            if (openingHours.get("openNow") instanceof Boolean openNow) {
                result.put("openNow", openNow);
            }
            if (openingHours.get("weekdayDescriptions") instanceof List<?> days) {
                List<String> weekdayList = new ArrayList<>();
                for (Object d : days) {
                    if (d != null) weekdayList.add(d.toString());
                }
                result.put("weekdayDescriptions", weekdayList);
            }
        }

        if (place.get("editorialSummary") instanceof Map<?, ?> summaryMap
                && summaryMap.get("text") != null) {
            result.put("editorialSummary", summaryMap.get("text").toString());
        }

        if (place.get("priceLevel") != null) {
            result.put("priceLevel", translatePriceLevel(place.get("priceLevel").toString()));
        }

        if (place.get("websiteUri") != null) {
            result.put("websiteUri", place.get("websiteUri").toString());
        }

        if (place.get("googleMapsUri") != null) {
            result.put("googleMapsUri", place.get("googleMapsUri").toString());
        }

        // 사진 URL 생성 (최대 4장, 백엔드 프록시 경유)
        List<String> photoUrls = new ArrayList<>();
        if (place.get("photos") instanceof List<?> photos) {
            int limit = Math.min(photos.size(), 4);
            for (int i = 0; i < limit; i++) {
                if (photos.get(i) instanceof Map<?, ?> photoMap && photoMap.get("name") != null) {
                    String photoName = photoMap.get("name").toString();
                    if (PHOTO_NAME_PATTERN.matcher(photoName).matches()) {
                        String encoded = URLEncoder.encode(photoName, StandardCharsets.UTF_8);
                        photoUrls.add("/api/map/place-photo?name=" + encoded + "&maxWidthPx=600");
                    }
                }
            }
        }
        result.put("photos", photoUrls);

        // 방문자 리뷰 파싱 (최대 3건)
        List<Map<String, Object>> normalizedReviews = new ArrayList<>();
        if (place.get("reviews") instanceof List<?> reviews) {
            int limit = Math.min(reviews.size(), 3);
            for (int i = 0; i < limit; i++) {
                if (reviews.get(i) instanceof Map<?, ?> rev) {
                    Map<String, Object> item = new LinkedHashMap<>();

                    String author = "익명 방문자";
                    if (rev.get("authorAttribution") instanceof Map<?, ?> attr
                            && attr.get("displayName") != null) {
                        author = attr.get("displayName").toString();
                    }
                    item.put("authorName", author);

                    if (rev.get("rating") instanceof Number revRating) {
                        item.put("rating", revRating.doubleValue());
                    }

                    if (rev.get("relativePublishTimeDescription") != null) {
                        item.put("relativeTime", rev.get("relativePublishTimeDescription").toString());
                    }

                    String text = "";
                    if (rev.get("text") instanceof Map<?, ?> textMap && textMap.get("text") != null) {
                        text = textMap.get("text").toString();
                    } else if (rev.get("originalText") instanceof Map<?, ?> origMap && origMap.get("text") != null) {
                        text = origMap.get("text").toString();
                    }
                    item.put("text", text);

                    if (!text.isEmpty() || item.containsKey("rating")) {
                        normalizedReviews.add(item);
                    }
                }
            }
        }
        result.put("reviews", normalizedReviews);

        return result;
    }

    private String buildSearchQuery(String name, String address) {
        if (address == null || address.trim().isEmpty()) {
            return name.trim();
        }
        String[] tokens = address.trim().split("\\s+");
        if (tokens.length >= 2) {
            return name.trim() + " " + tokens[0] + " " + tokens[1];
        }
        return name.trim() + " " + tokens[0];
    }

    private String translatePriceLevel(String level) {
        return switch (level) {
            case "PRICE_LEVEL_FREE" -> "무료";
            case "PRICE_LEVEL_INEXPENSIVE" -> "저렴함 (₩)";
            case "PRICE_LEVEL_MODERATE" -> "보통 (₩₩)";
            case "PRICE_LEVEL_EXPENSIVE" -> "다소 높음 (₩₩₩)";
            case "PRICE_LEVEL_VERY_EXPENSIVE" -> "고급 (₩₩₩₩)";
            default -> null;
        };
    }

    private Map<String, Object> buildStatusResponse(String status, String source, String message) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("status", status);
        map.put("source", source);
        map.put("message", message);
        return map;
    }

    private String buildCacheKey(String name, double lat, double lng, String kakaoPlaceId) {
        if (kakaoPlaceId != null && !kakaoPlaceId.trim().isEmpty()) {
            return "kakao:" + kakaoPlaceId.trim();
        }
        return String.format(Locale.ROOT, "%s@%.4f,%.4f", name.trim(), lat, lng);
    }

    private void putCache(String key, Map<String, Object> value) {
        if (cache.size() >= MAX_CACHE_ENTRIES) {
            cache.entrySet().removeIf(e -> e.getValue().isExpired());
            if (cache.size() >= MAX_CACHE_ENTRIES) {
                cache.clear();
            }
        }
        cache.put(key, new CacheEntry(value, Instant.now().toEpochMilli() + CACHE_TTL_MILLIS));
    }

    private double calculateHaversineMeters(double lat1, double lon1, double lat2, double lon2) {
        final double R = 6371000.0;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
    }

    private record CacheEntry(Map<String, Object> data, long expiresAtMillis) {
        boolean isExpired() {
            return Instant.now().toEpochMilli() > expiresAtMillis;
        }
    }
}
