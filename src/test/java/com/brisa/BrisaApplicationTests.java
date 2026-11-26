package com.brisa;

import com.brisa.controller.MapController;
import com.brisa.service.PlaceDetailService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
class BrisaApplicationTests {

    @Autowired
    private MapController mapController;

    @Autowired
    private PlaceDetailService placeDetailService;

    @Test
    void contextLoadsAndInjectsPlaceDetailService() {
        assertThat(mapController).isNotNull();
        assertThat(placeDetailService).isNotNull();
    }
}
