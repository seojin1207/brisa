package com.brisa.controller;

import com.brisa.service.KakaoMapService;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
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
    public Map<String, Object> testDensityScore(@RequestParam double lat, @RequestParam double lng) {
        int cafeCount = kakaoMapService.getCategoryCount(lat, lng, "CE7");
        int foodCount = kakaoMapService.getCategoryCount(lat, lng, "FD6");
        double score = kakaoMapService.calculateDensityScore(lat, lng);

        Map<String, Object> result = new HashMap<>();
        result.put("latitude", lat);
        result.put("longitude", lng);
        result.put("cafeCount", cafeCount);
        result.put("foodCount", foodCount);
        result.put("densityScore", score);

        return result;
    }
}