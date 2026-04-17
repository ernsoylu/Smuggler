package com.smuggler.desktop.api.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonIgnoreProperties(ignoreUnknown = true)
public record MuleHealth(
    String name,
    boolean healthy,
    String ip,
    String reason,
    @JsonProperty("checked_at") String checkedAt,
    @JsonProperty("consecutive_failures") Integer consecutiveFailures,
    Boolean evacuated
) {}
