package com.smuggler.desktop.api.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonIgnoreProperties(ignoreUnknown = true)
public record GlobalStats(
    @JsonProperty("download_speed") long downloadSpeed,
    @JsonProperty("upload_speed") long uploadSpeed,
    @JsonProperty("num_active") int numActive,
    @JsonProperty("num_waiting") int numWaiting,
    @JsonProperty("num_stopped") int numStopped,
    @JsonProperty("num_mules") int numMules,
    @JsonProperty("disk_free") Long diskFree,
    @JsonProperty("disk_total") Long diskTotal
) {
    public static GlobalStats empty() {
        return new GlobalStats(0, 0, 0, 0, 0, 0, null, null);
    }
}
