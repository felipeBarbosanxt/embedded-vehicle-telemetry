#include <inttypes.h>
#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "nvs_flash.h"
#include "mqtt_client.h"
#include <bmp180.h>
#include <mpu6050.h>

#define I2C_MASTER_SDA   18
#define I2C_MASTER_SCL   19

#define WIFI_SSID        "..."
#define WIFI_PASS        "505283fb"

#define MQTT_BROKER_URI  "mqtt://broker.hivemq.com"
#define MQTT_TOPIC       "tcc_felipe/hw290"

#define WIFI_CONNECTED_BIT BIT0

static const char *TAG = "test_hw290_mqtt";

static EventGroupHandle_t s_wifi_event_group;

static void event_handler(void *arg, esp_event_base_t event_base,
                          int32_t event_id, void *event_data)
{
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        ESP_LOGW(TAG, "Desconectado, tentando novamente...");
        esp_wifi_connect();
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        xEventGroupSetBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
    }
}

static void nvs_init(void)
{
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);
}

static void wifi_connect_sta(void)
{
    s_wifi_event_group = xEventGroupCreate();

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID,
                                                        &event_handler, NULL, NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP,
                                                        &event_handler, NULL, NULL));

    wifi_config_t wifi_config = {
        .sta = {
            .ssid = WIFI_SSID,
            .password = WIFI_PASS,
            .threshold.authmode = WIFI_AUTH_WPA2_PSK,
        },
    };
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    ESP_LOGI(TAG, "Conectando a \"%s\"...", WIFI_SSID);
    xEventGroupWaitBits(s_wifi_event_group, WIFI_CONNECTED_BIT, pdFALSE, pdFALSE, portMAX_DELAY);
    ESP_LOGI(TAG, "Wi-Fi conectado");
}

void app_main(void)
{
    nvs_init();
    wifi_connect_sta();

    esp_mqtt_client_config_t mqtt_cfg = {
        .broker.address.uri = MQTT_BROKER_URI,
    };
    esp_mqtt_client_handle_t client = esp_mqtt_client_init(&mqtt_cfg);
    ESP_ERROR_CHECK(esp_mqtt_client_start(client));

    ESP_ERROR_CHECK(i2cdev_init());

    mpu6050_dev_t mpu;
    memset(&mpu, 0, sizeof(mpu6050_dev_t));
    ESP_ERROR_CHECK(mpu6050_init_desc(&mpu, MPU6050_I2C_ADDRESS_LOW, 0, I2C_MASTER_SDA, I2C_MASTER_SCL));
    mpu.i2c_dev.cfg.master.clk_speed = 400000;
    mpu.i2c_dev.cfg.sda_pullup_en = 1;
    mpu.i2c_dev.cfg.scl_pullup_en = 1;
    ESP_ERROR_CHECK(mpu6050_init(&mpu));
    ESP_ERROR_CHECK(mpu6050_set_dlpf_mode(&mpu, MPU6050_DLPF_3));
    ESP_ERROR_CHECK(mpu6050_set_rate(&mpu, 4));

    ESP_LOGI(TAG, "Calibrando giroscopio, mantenha o sensor parado...");
    mpu6050_rotation_t gyro_offset = { 0 };
    for (int i = 0; i < 200; i++) {
        mpu6050_rotation_t r;
        ESP_ERROR_CHECK(mpu6050_get_rotation(&mpu, &r));
        gyro_offset.x += r.x;
        gyro_offset.y += r.y;
        gyro_offset.z += r.z;
        vTaskDelay(pdMS_TO_TICKS(5));
    }
    gyro_offset.x /= 200;
    gyro_offset.y /= 200;
    gyro_offset.z /= 200;
    ESP_LOGI(TAG, "Offset do giroscopio: x=%.4f y=%.4f z=%.4f",
             gyro_offset.x, gyro_offset.y, gyro_offset.z);

    bmp180_dev_t bmp;
    memset(&bmp, 0, sizeof(bmp180_dev_t));
    ESP_ERROR_CHECK(bmp180_init_desc(&bmp, 0, I2C_MASTER_SDA, I2C_MASTER_SCL));
    bmp.i2c_dev.cfg.master.clk_speed = 400000;
    bmp.i2c_dev.cfg.sda_pullup_en = 1;
    bmp.i2c_dev.cfg.scl_pullup_en = 1;
    ESP_ERROR_CHECK(bmp180_init(&bmp));

    char payload[256];

    while (1) {
        float temp, mpu_temp;
        uint32_t pressure;
        mpu6050_acceleration_t accel = { 0 };
        mpu6050_rotation_t rotation = { 0 };

        if (bmp180_measure(&bmp, &temp, &pressure, BMP180_MODE_STANDARD) != ESP_OK) {
            ESP_LOGE(TAG, "Falha na leitura do BMP180");
        } else if (mpu6050_get_motion(&mpu, &accel, &rotation) != ESP_OK ||
                   mpu6050_get_temperature(&mpu, &mpu_temp) != ESP_OK) {
            ESP_LOGE(TAG, "Falha na leitura do MPU6050");
        } else {
            rotation.x -= gyro_offset.x;
            rotation.y -= gyro_offset.y;
            rotation.z -= gyro_offset.z;

            int len = snprintf(payload, sizeof(payload),
                               "{\"temp\":%.2f,\"press\":%" PRIu32 ","
                               "\"ax\":%.4f,\"ay\":%.4f,\"az\":%.4f,"
                               "\"gx\":%.4f,\"gy\":%.4f,\"gz\":%.4f,"
                               "\"mpu_temp\":%.2f}",
                               temp, pressure,
                               accel.x, accel.y, accel.z,
                               rotation.x, rotation.y, rotation.z,
                               mpu_temp);
            esp_mqtt_client_publish(client, MQTT_TOPIC, payload, len, 0, 0);
            ESP_LOGI(TAG, "%s", payload);
        }

        vTaskDelay(pdMS_TO_TICKS(500));
    }
}
