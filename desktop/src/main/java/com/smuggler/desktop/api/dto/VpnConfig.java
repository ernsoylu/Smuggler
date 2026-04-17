package com.smuggler.desktop.api.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonIgnoreProperties(ignoreUnknown = true)
public record VpnConfig(
    long id,
    String name,
    String filename,
    @JsonProperty("created_at") String createdAt,
    @JsonProperty("vpn_type") String vpnType,
    @JsonProperty("requires_auth") boolean requiresAuth,
    @JsonProperty("in_use_by_mule") String inUseByMule
) {
    public boolean inUse() { return inUseByMule != null && !inUseByMule.isBlank(); }
}
