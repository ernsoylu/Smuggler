package com.smuggler.desktop.api.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonIgnoreProperties(ignoreUnknown = true)
public record TorrentFile(
    int index,
    String path,
    String name,
    @JsonProperty("total_length") long totalLength,
    @JsonProperty("completed_length") long completedLength,
    double progress,
    boolean selected
) {}
