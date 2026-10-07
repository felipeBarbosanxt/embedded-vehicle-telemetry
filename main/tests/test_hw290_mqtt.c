#include <inttypes.h>
#include <math.h>
#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/event_groups.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_timer.h"
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
#define MQTT_TOPIC_BRUTO MQTT_TOPIC "/bruto"
#define MQTT_OUTBOX_MAX  (32 * 1024)

#define PERIODO_MS          5
#define RESUMO_MS           500
#define ESTABILIZACAO_MS    2000
#define CALIBRACAO_AMOSTRAS 1000
#define GRAVIDADE_TAU_S     5.0f

#define MODO_COLETA      1
#define LOTE_AMOSTRAS    20

// Eixos do carrinho em funcao dos eixos do sensor (0 = x, 1 = y, 2 = z)
#define EIXO_FRENTE      0
#define SINAL_FRENTE     1
#define EIXO_ESQUERDA    1
#define SINAL_ESQUERDA   1
#define EIXO_CIMA        2
#define SINAL_CIMA       1

#define WIFI_CONNECTED_BIT BIT0

typedef struct {
    int64_t t_us;
    float acc[3];
    float gyro[3];
} amostra_t;

static const char *TAG = "test_hw290_mqtt";

static EventGroupHandle_t s_wifi_event_group;
static QueueHandle_t s_fila;
static mpu6050_dev_t s_mpu;
static float s_gyro_offset[3];
static float s_gravidade[3];
static uint32_t s_descartadas;

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
    ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));

    ESP_LOGI(TAG, "Conectando a \"%s\"...", WIFI_SSID);
    xEventGroupWaitBits(s_wifi_event_group, WIFI_CONNECTED_BIT, pdFALSE, pdFALSE, portMAX_DELAY);
    ESP_LOGI(TAG, "Wi-Fi conectado");
}

static void para_eixos_carrinho(const float v[3], float out[3])
{
    out[0] = SINAL_FRENTE * v[EIXO_FRENTE];
    out[1] = SINAL_ESQUERDA * v[EIXO_ESQUERDA];
    out[2] = SINAL_CIMA * v[EIXO_CIMA];
}

static void sensor_task(void *pvParameters)
{
    const float dt = PERIODO_MS / 1000.0f;
    const float alfa = dt / GRAVIDADE_TAU_S;
    TickType_t ultimo = xTaskGetTickCount();

    while (1) {
        mpu6050_acceleration_t accel;
        mpu6050_rotation_t rotation;

        if (mpu6050_get_motion(&s_mpu, &accel, &rotation) == ESP_OK) {
            float acc[3] = { accel.x, accel.y, accel.z };
            float gyro[3] = {
                rotation.x - s_gyro_offset[0],
                rotation.y - s_gyro_offset[1],
                rotation.z - s_gyro_offset[2],
            };
            amostra_t amostra = { .t_us = esp_timer_get_time() };
            float w[3] = {
                gyro[0] * (float)M_PI / 180.0f,
                gyro[1] * (float)M_PI / 180.0f,
                gyro[2] * (float)M_PI / 180.0f,
            };
            float g[3] = { s_gravidade[0], s_gravidade[1], s_gravidade[2] };

            // Gira a gravidade junto com o sensor: dg/dt = -w x g
            s_gravidade[0] -= dt * (w[1] * g[2] - w[2] * g[1]);
            s_gravidade[1] -= dt * (w[2] * g[0] - w[0] * g[2]);
            s_gravidade[2] -= dt * (w[0] * g[1] - w[1] * g[0]);

            for (int i = 0; i < 3; i++) {
                s_gravidade[i] += alfa * (acc[i] - s_gravidade[i]);
                acc[i] -= s_gravidade[i];
            }
            para_eixos_carrinho(acc, amostra.acc);
            para_eixos_carrinho(gyro, amostra.gyro);

            if (xQueueSend(s_fila, &amostra, 0) != pdTRUE) {
                s_descartadas++;
            }
        } else {
            ESP_LOGE(TAG, "Falha na leitura do MPU6050");
        }

        vTaskDelayUntil(&ultimo, pdMS_TO_TICKS(PERIODO_MS));
    }
}

void app_main(void)
{
    nvs_init();
    wifi_connect_sta();

    esp_mqtt_client_config_t mqtt_cfg = {
        .broker.address.uri = MQTT_BROKER_URI,
        .outbox.limit = MQTT_OUTBOX_MAX,
    };
    esp_mqtt_client_handle_t client = esp_mqtt_client_init(&mqtt_cfg);
    ESP_ERROR_CHECK(esp_mqtt_client_start(client));

    ESP_ERROR_CHECK(i2cdev_init());

    memset(&s_mpu, 0, sizeof(mpu6050_dev_t));
    ESP_ERROR_CHECK(mpu6050_init_desc(&s_mpu, MPU6050_I2C_ADDRESS_LOW, 0, I2C_MASTER_SDA, I2C_MASTER_SCL));
    s_mpu.i2c_dev.cfg.master.clk_speed = 400000;
    s_mpu.i2c_dev.cfg.sda_pullup_en = 1;
    s_mpu.i2c_dev.cfg.scl_pullup_en = 1;
    ESP_ERROR_CHECK(mpu6050_init(&s_mpu));
    ESP_ERROR_CHECK(mpu6050_set_full_scale_accel_range(&s_mpu, MPU6050_ACCEL_RANGE_16));
    ESP_ERROR_CHECK(mpu6050_set_full_scale_gyro_range(&s_mpu, MPU6050_GYRO_RANGE_2000));
    ESP_ERROR_CHECK(mpu6050_set_dlpf_mode(&s_mpu, MPU6050_DLPF_3));
    ESP_ERROR_CHECK(mpu6050_set_rate(&s_mpu, 4));
    vTaskDelay(pdMS_TO_TICKS(ESTABILIZACAO_MS));

    ESP_LOGI(TAG, "Calibrando, mantenha o sensor parado...");
    for (int i = 0; i < CALIBRACAO_AMOSTRAS; i++) {
        mpu6050_acceleration_t accel;
        mpu6050_rotation_t rotation;
        ESP_ERROR_CHECK(mpu6050_get_motion(&s_mpu, &accel, &rotation));
        s_gravidade[0] += accel.x;
        s_gravidade[1] += accel.y;
        s_gravidade[2] += accel.z;
        s_gyro_offset[0] += rotation.x;
        s_gyro_offset[1] += rotation.y;
        s_gyro_offset[2] += rotation.z;
        vTaskDelay(pdMS_TO_TICKS(PERIODO_MS));
    }
    for (int i = 0; i < 3; i++) {
        s_gravidade[i] /= CALIBRACAO_AMOSTRAS;
        s_gyro_offset[i] /= CALIBRACAO_AMOSTRAS;
    }
    ESP_LOGI(TAG, "Offset do giroscopio: x=%.4f y=%.4f z=%.4f",
             s_gyro_offset[0], s_gyro_offset[1], s_gyro_offset[2]);
    ESP_LOGI(TAG, "Gravidade: x=%.4f y=%.4f z=%.4f",
             s_gravidade[0], s_gravidade[1], s_gravidade[2]);

    bmp180_dev_t bmp;
    memset(&bmp, 0, sizeof(bmp180_dev_t));
    ESP_ERROR_CHECK(bmp180_init_desc(&bmp, 0, I2C_MASTER_SDA, I2C_MASTER_SCL));
    bmp.i2c_dev.cfg.master.clk_speed = 400000;
    bmp.i2c_dev.cfg.sda_pullup_en = 1;
    bmp.i2c_dev.cfg.scl_pullup_en = 1;
    ESP_ERROR_CHECK(bmp180_init(&bmp));

    s_fila = xQueueCreate(200, sizeof(amostra_t));
    xTaskCreatePinnedToCore(sensor_task, "sensor_task", 4096, NULL, 10, NULL, 1);

    static char payload[256];
#if MODO_COLETA
    static char lote[LOTE_AMOSTRAS * 96];
    int lote_len = 0;
    int lote_n = 0;
#endif
    float soma_acc[3] = { 0 };
    float soma_gyro[3] = { 0 };
    int n = 0;
    int64_t proximo_resumo = esp_timer_get_time() + RESUMO_MS * 1000;

    while (1) {
        amostra_t amostra;

        if (xQueueReceive(s_fila, &amostra, pdMS_TO_TICKS(RESUMO_MS)) == pdTRUE) {
            for (int i = 0; i < 3; i++) {
                soma_acc[i] += amostra.acc[i];
                soma_gyro[i] += amostra.gyro[i];
            }
            n++;

#if MODO_COLETA
            lote_len += snprintf(lote + lote_len, sizeof(lote) - lote_len,
                                 "%" PRId64 ",%.4f,%.4f,%.4f,%.4f,%.4f,%.4f\n",
                                 amostra.t_us / 1000,
                                 amostra.acc[0], amostra.acc[1], amostra.acc[2],
                                 amostra.gyro[0], amostra.gyro[1], amostra.gyro[2]);
            if (++lote_n == LOTE_AMOSTRAS) {
                esp_mqtt_client_enqueue(client, MQTT_TOPIC_BRUTO, lote, lote_len, 0, 0, true);
                lote_len = 0;
                lote_n = 0;
            }
#endif
        }

        if (esp_timer_get_time() >= proximo_resumo) {
            float temp, mpu_temp;
            uint32_t pressure;

            proximo_resumo += RESUMO_MS * 1000;

            if (bmp180_measure(&bmp, &temp, &pressure, BMP180_MODE_STANDARD) != ESP_OK) {
                ESP_LOGE(TAG, "Falha na leitura do BMP180");
            } else if (mpu6050_get_temperature(&s_mpu, &mpu_temp) != ESP_OK) {
                ESP_LOGE(TAG, "Falha na leitura do MPU6050");
            } else if (n > 0) {
                int len = snprintf(payload, sizeof(payload),
                                   "{\"temp\":%.2f,\"press\":%" PRIu32 ","
                                   "\"ax\":%.4f,\"ay\":%.4f,\"az\":%.4f,"
                                   "\"gx\":%.4f,\"gy\":%.4f,\"gz\":%.4f,"
                                   "\"mpu_temp\":%.2f}",
                                   temp, pressure,
                                   soma_acc[0] / n, soma_acc[1] / n, soma_acc[2] / n,
                                   soma_gyro[0] / n, soma_gyro[1] / n, soma_gyro[2] / n,
                                   mpu_temp);
                esp_mqtt_client_enqueue(client, MQTT_TOPIC, payload, len, 0, 0, true);
                ESP_LOGI(TAG, "%s", payload);
            }

            if (s_descartadas > 0) {
                ESP_LOGW(TAG, "Amostras descartadas: %" PRIu32, s_descartadas);
                s_descartadas = 0;
            }

            memset(soma_acc, 0, sizeof(soma_acc));
            memset(soma_gyro, 0, sizeof(soma_gyro));
            n = 0;
        }
    }
}
