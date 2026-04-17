package com.smuggler.desktop.api.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public record WatchdogStatus(
    Config config,
    Stats stats,
    List<MuleHealth> mules
) {
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Config(
        @JsonProperty("interval_seconds") int intervalSeconds,
        @JsonProperty("failure_threshold") int failureThreshold
    ) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Stats(
        @JsonProperty("started_at") String startedAt,
        @JsonProperty("last_run_at") String lastRunAt,
        @JsonProperty("total_sweeps") long totalSweeps,
        @JsonProperty("total_evacuations") long totalEvacuations
    ) {}
}
