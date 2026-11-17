package com.brisa.service;

import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class KakaoMapService {

    private final String KAKAO_REST_KEY = "eee9ff8636b6fb5dc4064e555f4cad58";
    private final String CATEGORY_URL = "https://dapi.kakao.com/v2/local/search/category.json";

    @SuppressWarnings("rawtypes")
    public Map<String, Double> calculateCenter(List locations) {
        double totalLat = 0;
        double totalLng = 0;
        int count = locations.size();

        for (Object item : locations) {
            Map loc = (Map) item;
            totalLat += Double.parseDouble(loc.get("lat").toString());
            totalLng += Double.parseDouble(loc.get("lng").toString());
        }

        Map<String, Double> center = new HashMap<>();
        center.put("lat", totalLat / count);
        center.put("lng", totalLng / count);
        return center;
    }

    @SuppressWarnings("rawtypes")
    public int getCategoryCount(double lat, double lng, String categoryCode) {
        RestTemplate restTemplate = new RestTemplate();

        HttpHeaders headers = new HttpHeaders();
        headers.set("Authorization", "KakaoAK " + KAKAO_REST_KEY);

        UriComponentsBuilder builder = UriComponentsBuilder.fromHttpUrl(CATEGORY_URL)
                .queryParam("category_group_code", categoryCode)
                .queryParam("x", lng)
                .queryParam("y", lat)
                .queryParam("radius", 500);

        HttpEntity<?> entity = new HttpEntity<>(headers);
        ResponseEntity response = restTemplate.exchange(
                builder.toUriString(), HttpMethod.GET, entity, Map.class
        );

        Map body = (Map) response.getBody();
        if (body != null && body.containsKey("meta")) {
            Map meta = (Map) body.get("meta");
            if (meta != null && meta.containsKey("total_count")) {
                return Integer.parseInt(meta.get("total_count").toString());
            }
        }
        return 0;
    }

    public double calculateDensityScore(double lat, double lng) {
        int cafeCount = getCategoryCount(lat, lng, "CE7");
        int foodCount = getCategoryCount(lat, lng, "FD6");
        return (cafeCount * 1.2) + (foodCount * 1.0);
    }
}