#include <stdbool.h>
#include <stdint.h>

#include "driver/usb_serial_jtag.h"
#include "esp_crt_bundle.h"
#include "esp_event.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_netif_sntp.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"

#define PPP_READY BIT0

static const char *TAG = "ppp_probe";
static EventGroupHandle_t link_events;
static esp_netif_t *ppp;

static esp_err_t usb_transmit(void *context, void *data, size_t length)
{
    int written = usb_serial_jtag_write_bytes(data, length, pdMS_TO_TICKS(50));
    return written >= 0 && (size_t)written == length ? ESP_OK : ESP_FAIL;
}

static void usb_receive(void *context)
{
    uint8_t buffer[512];
    for (;;) {
        int length = usb_serial_jtag_read_bytes(buffer, sizeof(buffer), pdMS_TO_TICKS(100));
        if (length > 0) {
            esp_netif_receive(ppp, buffer, length, NULL);
        }
    }
}

static void link_changed(void *context, esp_event_base_t base, int32_t event, void *data)
{
    if (event == IP_EVENT_PPP_GOT_IP) {
        const ip_event_got_ip_t *ip = data;
        ESP_LOGI(TAG, "PPP address " IPSTR ", peer " IPSTR,
                 IP2STR(&ip->ip_info.ip), IP2STR(&ip->ip_info.gw));
        xEventGroupSetBits(link_events, PPP_READY);
    } else if (event == IP_EVENT_PPP_LOST_IP) {
        xEventGroupClearBits(link_events, PPP_READY);
        ESP_LOGW(TAG, "PPP lost its address");
    }
}

static bool probe_http(const char *name, const char *url, bool tls)
{
    esp_http_client_config_t config = {
        .url = url,
        .timeout_ms = 8000,
        .disable_auto_redirect = true,
        .crt_bundle_attach = tls ? esp_crt_bundle_attach : NULL,
    };
    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) {
        ESP_LOGE(TAG, "%s: cannot initialize HTTP client", name);
        return false;
    }
    esp_err_t result = esp_http_client_perform(client);
    int status = esp_http_client_get_status_code(client);
    bool passed = result == ESP_OK && status >= 200 && status < 300;
    ESP_LOGI(TAG, "%s: %s (HTTP %d, %s)", name, passed ? "PASS" : "FAIL",
             status, esp_err_to_name(result));
    esp_http_client_cleanup(client);
    return passed;
}

void app_main(void)
{
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    link_events = xEventGroupCreate();
    configASSERT(link_events);

    static const usb_serial_jtag_driver_config_t usb = {
        .tx_buffer_size = 4096,
        .rx_buffer_size = 4096,
    };
    ESP_ERROR_CHECK(usb_serial_jtag_driver_install(&usb));

    esp_netif_inherent_config_t base = ESP_NETIF_INHERENT_DEFAULT_PPP();
    const esp_netif_driver_ifconfig_t driver = {
        .handle = &ppp,
        .transmit = usb_transmit,
    };
    const esp_netif_config_t config = {
        .base = &base,
        .driver = &driver,
        .stack = ESP_NETIF_NETSTACK_DEFAULT_PPP,
    };
    ppp = esp_netif_new(&config);
    configASSERT(ppp);
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_PPP_GOT_IP, link_changed, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_PPP_LOST_IP, link_changed, NULL));
    BaseType_t task_created = xTaskCreate(usb_receive, "usb_ppp_rx", 4096, NULL, 5, NULL);
    configASSERT(task_created == pdPASS);

    esp_netif_action_start(ppp, NULL, 0, NULL);
    ESP_LOGI(TAG, "Waiting for PPP peer");
    xEventGroupWaitBits(link_events, PPP_READY, pdFALSE, pdTRUE, portMAX_DELAY);

    bool peer = false;
    for (unsigned attempt = 0; attempt < 6 && !peer; ++attempt) {
        peer = probe_http("PPP peer", "http://10.77.0.1:8080/", false);
        if (!peer) {
            vTaskDelay(pdMS_TO_TICKS(5000));
        }
    }
    esp_sntp_config_t time_config = ESP_NETIF_SNTP_DEFAULT_CONFIG("time.cloudflare.com");
    ESP_ERROR_CHECK(esp_netif_sntp_init(&time_config));
    bool clock_synced = esp_netif_sntp_sync_wait(pdMS_TO_TICKS(20000)) == ESP_OK;
    esp_netif_sntp_deinit();
    if (!clock_synced) {
        ESP_LOGE(TAG, "Clock synchronization failed; cannot verify certificate validity dates");
    }
    bool internet = clock_synced && probe_http("Public HTTPS", "https://example.com/", true);
    bool django = CONFIG_PROBE_DJANGO_URL[0] &&
                  probe_http("Django health", CONFIG_PROBE_DJANGO_URL, false);
    ESP_LOGI(TAG, "Connectivity gate: %s", peer && internet && django ? "PASS" : "FAIL");
}
