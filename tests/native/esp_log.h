#pragma once

// The host tests exercise the firmware with diagnostics compiled out.
#ifndef ARDUHAL_LOG_LEVEL
#define ARDUHAL_LOG_LEVEL 0
#endif
#define ARDUHAL_LOG_LEVEL_ERROR 1
#define ARDUHAL_LOG_LEVEL_WARN 2
#define ARDUHAL_LOG_LEVEL_INFO 3
#define ARDUHAL_LOG_LEVEL_DEBUG 4
#define ARDUHAL_LOG_LEVEL_VERBOSE 5

#define ESP_LOGE(...) ((void)0)
#define ESP_LOGW(...) ((void)0)
#define ESP_LOGI(...) ((void)0)
#define ESP_LOGD(...) ((void)0)
#define ESP_LOGV(...) ((void)0)
