package com.smuggler.desktop.api.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonIgnoreProperties(ignoreUnknown = true)
public record AppSettings(
    @JsonProperty("download_dir") String downloadDir,
    @JsonProperty("max_concurrent_downloads") String maxConcurrentDownloads,
    @JsonProperty("max_download_speed") String maxDownloadSpeed,
    @JsonProperty("max_upload_speed") String maxUploadSpeed
) {}
