idf_component_register(SRCS "tests/test_hw290_mqtt.c"
                    PRIV_REQUIRES esp_wifi nvs_flash mqtt
                    INCLUDE_DIRS "")
