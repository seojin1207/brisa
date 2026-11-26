
package com.brisa.controller;

import com.brisa.service.KakaoMapService;
import com.brisa.service.PlaceDetailService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/map")
@CrossOrigin(origins = "*")
public class MapController {

    private final KakaoMapService kakaoMapService;
    private final PlaceDetailService placeDetailService;

    public MapController(
            KakaoMapService kakaoMapService,
            PlaceDetailService placeDetailService) {
        this.kakaoMapService = kakaoMapService;
        this.placeDetailService = placeDetailService;
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

    /**
     * [신규] 카카오 로컬 API에 없는 추가 상세 정보(평점, 영업시간, 리뷰, 사진 등) 조회
     */
    @GetMapping("/place-detail")
    public Map<String, Object> getPlaceDetail(
            @RequestParam String name,
            @RequestParam double lat,
            @RequestParam double lng,
            @RequestParam(required = false, defaultValue = "") String address,
            @RequestParam(required = false, defaultValue = "") String kakaoPlaceId) {

        return placeDetailService.getPlaceExtraDetail(name, lat, lng, address, kakaoPlaceId);
    }

    /**
     * [신규] Google Places 사진 프록시 (API 키 보호)
     */
    @GetMapping("/place-photo")
    public ResponseEntity<byte[]> getPlacePhoto(
            @RequestParam String name,
            @RequestParam(required = false, defaultValue = "600") int maxWidthPx) {

        return placeDetailService.fetchPlacePhoto(name, maxWidthPx);
    }
}
