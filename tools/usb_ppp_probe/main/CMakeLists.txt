idf_component_register(SRCS "probe.c" PRIV_REQUIRES
    esp_driver_usb_serial_jtag esp_event esp_netif esp_http_client mbedtls)
