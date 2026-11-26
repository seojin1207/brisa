package com.brisa.service;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class PlaceDetailServiceTest {

    @Test
    void returnsApiKeyNotConfiguredWhenKeyIsEmpty() {
        PlaceDetailService service = new PlaceDetailService("");

        Map<String, Object> result = service.getPlaceExtraDetail(
                "스타벅스 강남점", 37.4979, 127.0276, "서울 강남구 강남대로", "12345");

        assertThat(result.get("status")).isEqualTo("API_KEY_NOT_CONFIGURED");
        assertThat(result.get("source")).isEqualTo("KAKAO_ONLY");
    }

    @Test
    void parsesGooglePlacesResponseAndBuildsPhotoProxyUrls() {
        RestTemplate mockRest = mock(RestTemplate.class);
        Map<String, Object> fakePlace = Map.ofEntries(
                Map.entry("id", "ChIJ123"),
                Map.entry("location", Map.of("latitude", 37.4980, "longitude", 127.0277)),
                Map.entry("rating", 4.6),
                Map.entry("userRatingCount", 215),
                Map.entry("currentOpeningHours", Map.of(
                        "openNow", true,
                        "weekdayDescriptions", List.of("월요일: 오전 9:00 ~ 오후 10:00")
                )),
                Map.entry("priceLevel", "PRICE_LEVEL_MODERATE"),
                Map.entry("editorialSummary", Map.of("text", "분위기 좋은 스페셜티 카페")),
                Map.entry("websiteUri", "https://example.com"),
                Map.entry("photos", List.of(Map.of("name", "places/ChIJ123/photos/photo_abc"))),
                Map.entry("reviews", List.of(Map.of(
                        "authorAttribution", Map.of("displayName", "홍길동"),
                        "rating", 5.0,
                        "relativePublishTimeDescription", "2주 전",
                        "text", Map.of("text", "커피가 정말 맛있어요.")
                )))
        );

        when(mockRest.exchange(
                anyString(),
                eq(HttpMethod.POST),
                any(HttpEntity.class),
                eq(Map.class)
        )).thenReturn(ResponseEntity.ok(Map.of("places", List.of(fakePlace))));

        PlaceDetailService service = new PlaceDetailService("test-valid-key", mockRest);

        Map<String, Object> result = service.getPlaceExtraDetail(
                "테스트카페", 37.4979, 127.0276, "서울 강남구 역삼동", "999");

        assertThat(result.get("status")).isEqualTo("OK");
        assertThat(result.get("rating")).isEqualTo(4.6);
        assertThat(result.get("userRatingCount")).isEqualTo(215);
        assertThat(result.get("openNow")).isEqualTo(true);
        assertThat(result.get("priceLevel")).isEqualTo("보통 (₩₩)");
        assertThat(result.get("editorialSummary")).isEqualTo("분위기 좋은 스페셜티 카페");

        @SuppressWarnings("unchecked")
        List<String> photos = (List<String>) result.get("photos");
        assertThat(photos).hasSize(1);
        assertThat(photos.get(0)).startsWith("/api/map/place-photo?name=");

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> reviews = (List<Map<String, Object>>) result.get("reviews");
        assertThat(reviews).hasSize(1);
        assertThat(reviews.get(0).get("authorName")).isEqualTo("홍길동");
        assertThat(reviews.get(0).get("text")).isEqualTo("커피가 정말 맛있어요.");
    }

    @Test
    void rejectsInvalidPhotoResourceNameToPreventSsrf() {
        RestTemplate mockRest = mock(RestTemplate.class);
        PlaceDetailService service = new PlaceDetailService("test-valid-key", mockRest);

        ResponseEntity<byte[]> resp = service.fetchPlacePhoto("../../etc/passwd", 600);
        assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }
}
