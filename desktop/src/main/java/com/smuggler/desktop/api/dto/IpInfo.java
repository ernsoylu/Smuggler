package com.smuggler.desktop.api.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
public record IpInfo(String ip, String city, String region, String country, String org) {}
