
package com.brisa.service;

import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.*;

@Service
public class KakaoMapService {

    // 실제 발급받은 API 키를 입력하세요.
    private final String KAKAO_REST_KEY = "YOUR_KAKAO_REST_API_KEY";
    private final String ODSAY_API_KEY = "";

    private final String CATEGORY_URL =
            "https://dapi.kakao.com/v2/local/search/category.json";

    private final String KEYWORD_URL =
            "https://dapi.kakao.com/v2/local/search/keyword.json";

    private final String ODSAY_TRANSIT_URL =
            "https://api.odsay.com/v1/api/searchPubTransPathT";


    // ==================== 기하학적 중심 계산 ====================

    public Map<String, Double> calculateGeometricCenter(
            List<Map<String, Object>> locations) {

        double totalLat = 0;
        double totalLng = 0;
        int count = locations.size();

        for (Map<String, Object> loc : locations) {
            totalLat += Double.parseDouble(loc.get("lat").toString());
            totalLng += Double.parseDouble(loc.get("lng").toString());
        }

        Map<String, Double> center = new HashMap<>();
        center.put("lat", totalLat / count);
        center.put("lng", totalLng / count);

        return center;
    }


    // ==================== 최적 대중교통 중심지 계산 ====================

    public Map<String, Object> calculateTransitOptimalCenter(
            List<Map<String, Object>> locations,
            String purpose) {

        Map<String, Object> response = new HashMap<>();

        if (locations == null || locations.isEmpty()) {
            response.put("status", "ERROR");
            response.put("message", "출발지 정보가 없습니다.");
            return response;
        }

        // 1. 기하학적 중심 계산
        Map<String, Double> geoCenter =
                calculateGeometricCenter(locations);

        double baseLat = geoCenter.get("lat");
        double baseLng = geoCenter.get("lng");

        // 2. 반경 5km 내 지하철역 검색
        List<Map<String, Object>> candidates =
                searchPlacesByCategory(baseLat, baseLng, "SW8", 5000);

        if (candidates.isEmpty()) {
            candidates =
                    searchPlacesByKeyword(baseLat, baseLng, "역", 10000);
        }

        Map<String, Object> bestCandidate = null;
        double bestCostScore = Double.MAX_VALUE;

        List<Integer> bestTravelMinutes = new ArrayList<>();

        // 3. 후보지별 이동시간 및 모임 성격 기반 상권 분석
        for (Map<String, Object> cand : candidates) {

            double cLat = Double.parseDouble(cand.get("y").toString());
            double cLng = Double.parseDouble(cand.get("x").toString());

            String placeName = cand.get("place_name").toString();

            int foodCount =
                    getCategoryCount(cLat, cLng, "FD6", 500);

            int cafeCount =
                    getCategoryCount(cLat, cLng, "CE7", 500);

            int baseCommercialCount = foodCount + cafeCount;

            if (baseCommercialCount < 5) {
                continue;
            }

            // 모임 성격별 특화 상권 보너스 점수
            double purposeBonus =
                    Math.min(baseCommercialCount * 0.05, 8.0);

            if ("SHOPPING".equalsIgnoreCase(purpose)) {

                int martCount =
                        getCategoryCount(cLat, cLng, "MT1", 800);

                purposeBonus += Math.min(martCount * 1.5, 6.0);

            } else if ("CULTURE".equalsIgnoreCase(purpose)) {

                int cultureCount =
                        getCategoryCount(cLat, cLng, "CT1", 800);

                purposeBonus += Math.min(cultureCount * 1.2, 6.0);
            }

            // 각 출발지에서 후보지까지 이동시간 계산
            List<Integer> travelTimes = new ArrayList<>();

            for (Map<String, Object> start : locations) {

                double sLat =
                        Double.parseDouble(start.get("lat").toString());

                double sLng =
                        Double.parseDouble(start.get("lng").toString());

                int minutes =
                        getTransitTimeMinutes(sLat, sLng, cLat, cLng);

                travelTimes.add(minutes);
            }

            // 평균 이동시간 계산
            double avgTime = travelTimes.stream()
                    .mapToInt(Integer::intValue)
                    .average()
                    .orElse(0);

            // 이동시간 표준편차 계산
            double variance = 0;

            for (int t : travelTimes) {
                variance += Math.pow(t - avgTime, 2);
            }

            double stdDev =
                    Math.sqrt(variance / travelTimes.size());

            // 최종 점수 계산
            double costScore =
                    avgTime + (stdDev * 1.5) - purposeBonus;

            if (costScore < bestCostScore) {

                bestCostScore = costScore;

                bestCandidate = new HashMap<>();

                bestCandidate.put("placeName", placeName);
                bestCandidate.put("lat", cLat);
                bestCandidate.put("lng", cLng);
                bestCandidate.put("avgMinutes", Math.round(avgTime));

                bestCandidate.put(
                        "stdDevMinutes",
                        Math.round(stdDev * 10.0) / 10.0
                );

                bestCandidate.put(
                        "commercialCount",
                        baseCommercialCount
                );

                bestTravelMinutes = travelTimes;
            }
        }

        // 4. 최종 결과 반환
        if (bestCandidate != null) {

            response.put("status", "OPTIMAL_TRANSIT_FOUND");

            response.put(
                    "centerName",
                    bestCandidate.get("placeName") + " 인근 상권"
            );

            response.put("latitude", bestCandidate.get("lat"));
            response.put("longitude", bestCandidate.get("lng"));
            response.put("avgMinutes", bestCandidate.get("avgMinutes"));
            response.put("stdDevMinutes", bestCandidate.get("stdDevMinutes"));

            response.put("memberTravelMinutes", bestTravelMinutes);

        } else {

            response.put("status", "FALLBACK_GEOMETRIC");
            response.put("centerName", "중간 지점");
            response.put("latitude", baseLat);
            response.put("longitude", baseLng);
        }

        return response;
    }


    // ==================== 대중교통 이동시간 계산 ====================

    @SuppressWarnings("unchecked")
    private int getTransitTimeMinutes(
            double startLat,
            double startLng,
            double endLat,
            double endLng) {

        if (ODSAY_API_KEY != null && !ODSAY_API_KEY.isEmpty()) {

            try {

                RestTemplate restTemplate = new RestTemplate();

                String url = UriComponentsBuilder
                        .fromHttpUrl(ODSAY_TRANSIT_URL)
                        .queryParam("SX", startLng)
                        .queryParam("SY", startLat)
                        .queryParam("EX", endLng)
                        .queryParam("EY", endLat)
                        .queryParam("apiKey", ODSAY_API_KEY)
                        .build()
                        .encode()
                        .toUriString();

                Map<String, Object> body =
                        restTemplate.getForObject(url, Map.class);

                if (body != null && body.containsKey("result")) {

                    Map<String, Object> result =
                            (Map<String, Object>) body.get("result");

                    List<Map<String, Object>> paths =
                            (List<Map<String, Object>>) result.get("path");

                    if (paths != null && !paths.isEmpty()) {

                        Map<String, Object> path = paths.get(0);

                        Map<String, Object> info =
                                (Map<String, Object>) path.get("info");

                        if (info != null && info.containsKey("totalTime")) {
                            return Integer.parseInt(
                                    info.get("totalTime").toString()
                            );
                        }
                    }
                }

            } catch (Exception e) {
                System.out.println(
                        "ODsay API 호출 실패: " + e.getMessage()
                );
            }
        }

        // ODsay API 사용이 불가능할 경우 거리 기반 예상시간 계산
        double distKm = calculateHaversineKm(
                startLat, startLng, endLat, endLng
        );

        return (int) Math.round((distKm / 25.0) * 60.0 + 10.0);
    }


    // ==================== 두 좌표 사이 거리 계산 ====================

    private double calculateHaversineKm(
            double lat1,
            double lon1,
            double lat2,
            double lon2) {

        final int R = 6371;

        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);

        double a =
                Math.sin(dLat / 2) * Math.sin(dLat / 2)
                        + Math.cos(Math.toRadians(lat1))
                        * Math.cos(Math.toRadians(lat2))
                        * Math.sin(dLon / 2)
                        * Math.sin(dLon / 2);

        double c =
                2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c;
    }


    // ==================== 카카오 카테고리 검색 ====================

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> searchPlacesByCategory(
            double lat,
            double lng,
            String categoryCode,
            int radius) {

        RestTemplate restTemplate = new RestTemplate();

        HttpHeaders headers = new HttpHeaders();

        headers.set(
                "Authorization",
                "KakaoAK " + KAKAO_REST_KEY
        );

        UriComponentsBuilder builder =
                UriComponentsBuilder.fromHttpUrl(CATEGORY_URL)
                        .queryParam("category_group_code", categoryCode)
                        .queryParam("x", lng)
                        .queryParam("y", lat)
                        .queryParam("radius", radius)
                        .queryParam("size", 10);

        ResponseEntity<Map> response = restTemplate.exchange(
                builder.toUriString(),
                HttpMethod.GET,
                new HttpEntity<>(headers),
                Map.class
        );

        Map<String, Object> body = response.getBody();

        if (body != null && body.containsKey("documents")) {

            return (List<Map<String, Object>>) body.get("documents");
        }

        return Collections.emptyList();
    }


    // ==================== 카카오 키워드 검색 ====================

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> searchPlacesByKeyword(
            double lat,
            double lng,
            String query,
            int radius) {

        RestTemplate restTemplate = new RestTemplate();

        HttpHeaders headers = new HttpHeaders();

        headers.set(
                "Authorization",
                "KakaoAK " + KAKAO_REST_KEY
        );

        UriComponentsBuilder builder =
                UriComponentsBuilder.fromHttpUrl(KEYWORD_URL)
                        .queryParam("query", query)
                        .queryParam("x", lng)
                        .queryParam("y", lat)
                        .queryParam("radius", radius)
                        .queryParam("size", 10);

        ResponseEntity<Map> response = restTemplate.exchange(
                builder.toUriString(),
                HttpMethod.GET,
                new HttpEntity<>(headers),
                Map.class
        );

        Map<String, Object> body = response.getBody();

        if (body != null && body.containsKey("documents")) {

            return (List<Map<String, Object>>) body.get("documents");
        }

        return Collections.emptyList();
    }


    // ==================== 카테고리 장소 개수 조회 ====================

    @SuppressWarnings("unchecked")
    public int getCategoryCount(
            double lat,
            double lng,
            String categoryCode,
            int radius) {

        RestTemplate restTemplate = new RestTemplate();

        HttpHeaders headers = new HttpHeaders();

        headers.set(
                "Authorization",
                "KakaoAK " + KAKAO_REST_KEY
        );

        UriComponentsBuilder builder =
                UriComponentsBuilder.fromHttpUrl(CATEGORY_URL)
                        .queryParam("category_group_code", categoryCode)
                        .queryParam("x", lng)
                        .queryParam("y", lat)
                        .queryParam("radius", radius);

        HttpEntity<?> entity = new HttpEntity<>(headers);

        ResponseEntity<Map> response = restTemplate.exchange(
                builder.toUriString(),
                HttpMethod.GET,
                entity,
                Map.class
        );

        Map<String, Object> body = response.getBody();

        if (body != null && body.containsKey("meta")) {

            Map<String, Object> meta =
                    (Map<String, Object>) body.get("meta");

            if (meta != null && meta.containsKey("total_count")) {

                return Integer.parseInt(
                        meta.get("total_count").toString()
                );
            }
        }

        return 0;
    }


    // ==================== 상권 밀집도 점수 계산 ====================

    public double calculateDensityScore(double lat, double lng) {

        int cafeCount =
                getCategoryCount(lat, lng, "CE7", 500);

        int foodCount =
                getCategoryCount(lat, lng, "FD6", 500);

        return (cafeCount * 1.2) + (foodCount * 1.0);
    }
}
