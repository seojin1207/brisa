package com.brisa.controller;

import com.brisa.service.KakaoMapService;
import com.brisa.service.PlaceDetailService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(MapController.class)
class MapControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private KakaoMapService kakaoMapService;

    @MockBean
    private PlaceDetailService placeDetailService;

    @Test
    void getPlaceDetailEndpointReturnsServicePayload() throws Exception {
        when(placeDetailService.getPlaceExtraDetail(
                eq("강남맛집"), eq(37.4979), eq(127.0276), eq("서울 강남구"), eq("101")))
                .thenReturn(Map.of(
                        "status", "OK",
                        "source", "GOOGLE_PLACES",
                        "rating", 4.5,
                        "openNow", true
                ));

        mockMvc.perform(get("/api/map/place-detail")
                        .param("name", "강남맛집")
                        .param("lat", "37.4979")
                        .param("lng", "127.0276")
                        .param("address", "서울 강남구")
                        .param("kakaoPlaceId", "101"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("OK"))
                .andExpect(jsonPath("$.rating").value(4.5))
                .andExpect(jsonPath("$.openNow").value(true));
    }
}
