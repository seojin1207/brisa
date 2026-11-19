
package com.brisa.controller;

import com.brisa.service.KakaoMapService;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/map")
@CrossOrigin(origins = "*")
public class MapController {

    private final KakaoMapService kakaoMapService;

    public MapController(KakaoMapService kakaoMapService) {
        this.kakaoMapService = kakaoMapService;
    }

    @GetMapping("/test")
    public Map<String, Object> testDensityScore(
            @RequestParam double lat,
            @RequestParam double lng) {

        int cafeCount = kakaoMapService.getCategoryCount(lat, lng, "CE7", 500);
        int foodCount = kakaoMapService.getCategoryCount(lat, lng, "FD6", 500);
        double score = kakaoMapService.calculateDensityScore(lat, lng);

        Map<String, Object> result = new HashMap<>();

        result.put("latitude", lat);
        result.put("longitude", lng);
        result.put("cafeCount", cafeCount);
        result.put("foodCount", foodCount);
        result.put("densityScore", score);

        return result;
    }

    /**
     * [신규] 각 인원 출발지 기준 대중교통 이동시간이
     * 가장 균등한 역/상권 중심지 분석
     */
    @PostMapping("/optimal-center")
    @SuppressWarnings("unchecked")
    public Map<String, Object> findOptimalTransitCenter(
            @RequestBody Map<String, Object> request) {

        List<Map<String, Object>> locations =
                (List<Map<String, Object>>) request.get("locations");

        String purpose = request.getOrDefault("purpose", "DINING").toString();

        return kakaoMapService.calculateTransitOptimalCenter(
                locations,
                purpose
        );
    }
}
