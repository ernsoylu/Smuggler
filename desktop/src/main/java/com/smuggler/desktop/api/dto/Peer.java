package com.smuggler.desktop.api.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonIgnoreProperties(ignoreUnknown = true)
public record Peer(
    String ip,
    String port,
    @JsonProperty("download_speed") long downloadSpeed,
    @JsonProperty("upload_speed") long uploadSpeed,
    boolean seeder,
    double progress,
    @JsonProperty("am_choking") boolean amChoking,
    @JsonProperty("peer_choking") boolean peerChoking
) {}
