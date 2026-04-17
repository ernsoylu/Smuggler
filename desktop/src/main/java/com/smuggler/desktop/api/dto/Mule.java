package com.smuggler.desktop.api.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonIgnoreProperties(ignoreUnknown = true)
public record Mule(
    String name,
    String id,
    String status,
    @JsonProperty("rpc_port") int rpcPort,
    @JsonProperty("vpn_config") String vpnConfig,
    @JsonProperty("ip_info") IpInfo ipInfo
) {}
