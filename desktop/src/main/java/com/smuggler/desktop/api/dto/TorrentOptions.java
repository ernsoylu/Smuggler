package com.smuggler.desktop.api.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonIgnoreProperties(ignoreUnknown = true)
public record TorrentOptions(
    @JsonProperty("max_download_speed") long maxDownloadSpeed,
    @JsonProperty("max_upload_speed") long maxUploadSpeed,
    @JsonProperty("max_connections") int maxConnections
) {}
