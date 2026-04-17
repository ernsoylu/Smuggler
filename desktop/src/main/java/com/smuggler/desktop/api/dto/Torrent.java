package com.smuggler.desktop.api.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public record Torrent(
    String gid,
    String mule,
    String name,
    String status,
    @JsonProperty("completed_length") long completedLength,
    @JsonProperty("total_length") long totalLength,
    @JsonProperty("uploaded_length") long uploadedLength,
    @JsonProperty("download_speed") long downloadSpeed,
    @JsonProperty("upload_speed") long uploadSpeed,
    double progress,
    @JsonProperty("num_seeders") int numSeeders,
    int connections,
    @JsonProperty("info_hash") String infoHash,
    @JsonProperty("is_seed") boolean isSeed,
    @JsonProperty("save_path") String savePath,
    @JsonProperty("piece_length") long pieceLength,
    @JsonProperty("num_pieces") int numPieces,
    long eta,
    double ratio,
    String tracker,
    String comment,
    @JsonProperty("creation_date") long creationDate,
    String mode,
    @JsonProperty("error_code") String errorCode,
    @JsonProperty("error_message") String errorMessage,
    List<TorrentFile> files,
    @JsonProperty("is_metadata") Boolean isMetadata
) {}
