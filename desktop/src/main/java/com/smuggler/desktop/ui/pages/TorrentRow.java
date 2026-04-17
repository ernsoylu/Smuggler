package com.smuggler.desktop.ui.pages;

import com.smuggler.desktop.api.ApiClient;
import com.smuggler.desktop.api.dto.Torrent;
import com.smuggler.desktop.api.dto.TorrentFile;
import com.smuggler.desktop.ui.Format;
import com.smuggler.desktop.ui.Icons;
import com.smuggler.desktop.ui.modals.ConfirmModal;
import javafx.application.Platform;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.Node;
import javafx.scene.control.Button;
import javafx.scene.control.Label;
import javafx.scene.control.ProgressBar;
import javafx.scene.layout.FlowPane;
import javafx.scene.layout.HBox;
import javafx.scene.layout.Priority;
import javafx.scene.layout.Region;
import javafx.scene.layout.StackPane;
import javafx.scene.layout.VBox;
import org.kordamp.ikonli.feather.Feather;

import java.util.List;

/** Single torrent row — collapsed summary line + optional expanded details. */
public final class TorrentRow {

    private final ApiClient api;
    private final Torrent t;
    private final Runnable onRefresh;
    private final VBox root = new VBox();
    private final VBox details = new VBox(12);
    private boolean expanded = false;

    public TorrentRow(ApiClient api, Torrent t, Runnable onRefresh) {
        this.api = api;
        this.t = t;
        this.onRefresh = onRefresh == null ? () -> {} : onRefresh;
        build();
    }

    public Node node() { return root; }

    private void build() {
        root.setStyle("-fx-background-color: rgba(255,255,255,0.01); -fx-background-radius: 10; -fx-border-color: rgba(255,255,255,0.04); -fx-border-width: 1; -fx-border-radius: 10;");
        root.setPadding(new Insets(8, 12, 8, 12));

        HBox row = new HBox(12);
        row.setAlignment(Pos.CENTER_LEFT);

        // Chevron + name + gid
        Button chevron = new Button();
        chevron.setGraphic(Icons.of(Feather.CHEVRON_RIGHT, 16, "icon-muted"));
        chevron.getStyleClass().add("btn-icon");
        chevron.setOnAction(e -> toggleExpand(chevron));

        Label name = new Label(t.name() == null || t.name().isBlank() ? t.gid() : t.name());
        name.setStyle("-fx-text-fill: #fafafa; -fx-font-weight: 500;");
        name.setMaxWidth(280);

        Label sub = new Label(t.mule() + " • " + t.gid());
        sub.getStyleClass().addAll("muted-xs", "mono");
        sub.setMaxWidth(280);

        VBox nameCol = new VBox(2, name, sub);
        HBox nameCluster = new HBox(6, chevron, nameCol);
        nameCluster.setAlignment(Pos.CENTER_LEFT);
        nameCluster.setMinWidth(360);
        nameCluster.setPrefWidth(360);

        // Status pill
        Label status = new Label(t.status().toUpperCase());
        status.getStyleClass().addAll("status-pill", "status-" + Format.statusKey(t.status()));
        StackPane statusWrap = new StackPane(status);
        statusWrap.setMinWidth(90);
        statusWrap.setPrefWidth(90);
        statusWrap.setAlignment(Pos.CENTER_LEFT);

        // Progress bar
        ProgressBar pb = new ProgressBar(Math.min(1.0, t.progress() / 100.0));
        pb.setPrefWidth(150);
        pb.setPrefHeight(6);
        String barColor = switch (Format.statusKey(t.status())) {
            case "paused" -> "blue";
            case "waiting" -> "orange";
            case "error" -> "red";
            case "complete" -> "neutral";
            default -> "";
        };
        if (!barColor.isEmpty()) pb.getStyleClass().add(barColor);
        Label pbLabel = new Label(String.format("%s / %s · %.1f%%",
            Format.bytesShort(t.completedLength()),
            Format.bytesShort(t.totalLength()),
            t.progress()));
        pbLabel.getStyleClass().addAll("muted-xs", "mono");
        VBox progressCol = new VBox(4, pb, pbLabel);
        progressCol.setMinWidth(220);
        progressCol.setPrefWidth(220);

        // ETA
        Label eta = new Label(t.status().equals("active") && t.eta() != 0 ? Format.eta(t.eta()) : "—");
        eta.getStyleClass().addAll("muted", "mono");
        eta.setMinWidth(70);
        eta.setPrefWidth(70);

        // Speed
        Label dl = new Label(Format.speed(t.downloadSpeed()) + "  ↓");
        dl.setStyle("-fx-text-fill: #34d399; -fx-font-family: monospace; -fx-font-size: 11px;");
        Label ul = new Label(Format.speed(t.uploadSpeed()) + "  ↑");
        ul.setStyle("-fx-text-fill: #60a5fa; -fx-font-family: monospace; -fx-font-size: 11px;");
        VBox speedCol = new VBox(2, dl, ul);
        speedCol.setMinWidth(110);
        speedCol.setPrefWidth(110);

        // Seeds / peers
        Label sp = new Label(t.numSeeders() + " / " + t.connections());
        sp.getStyleClass().addAll("chip", "mono");
        StackPane spWrap = new StackPane(sp);
        spWrap.setAlignment(Pos.CENTER_LEFT);
        spWrap.setMinWidth(60);
        spWrap.setPrefWidth(60);

        // Mule chip
        Label muleChip = new Label(t.mule());
        muleChip.getStyleClass().addAll("chip", "mono");
        StackPane mWrap = new StackPane(muleChip);
        mWrap.setAlignment(Pos.CENTER_LEFT);
        mWrap.setMinWidth(100);
        mWrap.setPrefWidth(100);

        Region stretch = new Region();
        HBox.setHgrow(stretch, Priority.ALWAYS);

        // Actions
        Button play = new Button(null, Icons.of(Feather.PLAY, 14, "icon-blue"));
        play.getStyleClass().addAll("btn-icon", "btn-icon-blue");
        Button pause = new Button(null, Icons.of(Feather.PAUSE, 14, "icon-muted"));
        pause.getStyleClass().add("btn-icon");
        Button trash = new Button(null, Icons.of(Feather.TRASH_2, 14, "icon-red"));
        trash.getStyleClass().addAll("btn-icon", "btn-icon-red");

        boolean canStart = !(t.status().equals("active") || t.status().equals("waiting"));
        boolean canStop = !(t.status().equals("paused") || t.status().equals("complete")
            || t.status().equals("error") || t.status().equals("removed"));
        play.setDisable(!canStart);
        pause.setDisable(!canStop);

        play.setOnAction(e -> api.resumeTorrent(t.mule(), t.gid())
            .whenComplete((x, err) -> Platform.runLater(onRefresh)));
        pause.setOnAction(e -> api.pauseTorrent(t.mule(), t.gid())
            .whenComplete((x, err) -> Platform.runLater(onRefresh)));
        trash.setOnAction(e -> ConfirmModal.show(
            root.getScene().getWindow(),
            "Remove torrent?",
            "Remove “" + (t.name() == null ? t.gid() : t.name()) + "” from " + t.mule() + ".",
            "Remove", true, "Also delete downloaded files",
            deleteFiles -> api.removeTorrent(t.mule(), t.gid(), deleteFiles)
                .whenComplete((x, err) -> Platform.runLater(onRefresh))
        ));

        HBox actions = new HBox(6, play, pause, trash);
        actions.setAlignment(Pos.CENTER_RIGHT);

        row.getChildren().addAll(nameCluster, statusWrap, progressCol, eta, speedCol, spWrap, mWrap, stretch, actions);

        details.setVisible(false);
        details.setManaged(false);
        details.setPadding(new Insets(14, 8, 6, 34));
        details.setStyle("-fx-border-color: rgba(255,255,255,0.05); -fx-border-width: 1 0 0 0;");

        root.getChildren().addAll(row, details);
    }

    private void toggleExpand(Button chevron) {
        expanded = !expanded;
        details.setVisible(expanded);
        details.setManaged(expanded);
        chevron.setGraphic(Icons.of(expanded ? Feather.CHEVRON_DOWN : Feather.CHEVRON_RIGHT, 16, "icon-muted"));
        if (expanded) populateDetails();
    }

    private void populateDetails() {
        details.getChildren().clear();

        // Summary grid: Downloaded, Uploaded, Remaining, Ratio, DL, UL, Seeds, Peers
        FlowPane grid = new FlowPane(10, 10);
        grid.getChildren().addAll(
            chip("DOWNLOADED", Format.bytes(t.completedLength()), "#34d399"),
            chip("UPLOADED", Format.bytes(t.uploadedLength()), "#60a5fa"),
            chip("REMAINING", Format.bytes(Math.max(0, t.totalLength() - t.completedLength())), "#e5e5e5"),
            chip("RATIO", String.format("%.3f", t.ratio()), t.ratio() >= 1 ? "#34d399" : "#e5e5e5"),
            chip("DL SPEED", Format.speed(t.downloadSpeed()), "#34d399"),
            chip("UL SPEED", Format.speed(t.uploadSpeed()), "#60a5fa"),
            chip("SEEDS", String.valueOf(t.numSeeders()), "#e5e5e5"),
            chip("PEERS", String.valueOf(t.connections()), "#e5e5e5"),
            chip("TOTAL SIZE", Format.bytes(t.totalLength()), "#e5e5e5")
        );
        if (t.errorMessage() != null && !t.errorMessage().isBlank()) {
            grid.getChildren().add(errorChip(t.errorCode(), t.errorMessage()));
        }
        details.getChildren().add(grid);

        if (t.infoHash() != null && !t.infoHash().isBlank()) {
            details.getChildren().add(pathChip("INFO HASH", t.infoHash()));
        }
        if (t.savePath() != null && !t.savePath().isBlank()) {
            details.getChildren().add(pathChip("SAVE PATH", t.savePath()));
        }
        if (t.tracker() != null && !t.tracker().isBlank()) {
            details.getChildren().add(pathChip("TRACKER", t.tracker()));
        }

        // Files list
        List<TorrentFile> files = t.files();
        if (files != null && !files.isEmpty()) {
            Label fl = new Label("FILES (" + files.size() + ")");
            fl.getStyleClass().add("uppercase-label");
            VBox fileBox = new VBox(4);
            fileBox.setPadding(new Insets(0, 0, 0, 2));
            int shown = 0;
            for (TorrentFile f : files) {
                if (shown++ >= 40) { // cap for perf
                    Label more = new Label("… and " + (files.size() - 40) + " more");
                    more.getStyleClass().add("muted-xs");
                    fileBox.getChildren().add(more);
                    break;
                }
                fileBox.getChildren().add(fileRow(f));
            }
            details.getChildren().addAll(fl, fileBox);
        }
    }

    private Node chip(String label, String value, String valueColor) {
        Label k = new Label(label); k.getStyleClass().add("uppercase-label");
        Label v = new Label(value);
        v.setStyle("-fx-text-fill: " + valueColor + "; -fx-font-family: monospace; -fx-font-size: 13px;");
        VBox b = new VBox(3, k, v);
        b.getStyleClass().add("data-chip");
        b.setMinWidth(130);
        return b;
    }

    private Node errorChip(String code, String msg) {
        Label k = new Label("ERROR" + (code == null || code.isBlank() ? "" : " (" + code + ")"));
        k.setStyle("-fx-text-fill: #fca5a5; -fx-font-weight: bold; -fx-font-size: 10px;");
        Label v = new Label(msg);
        v.setStyle("-fx-text-fill: #fecaca; -fx-font-size: 12px;");
        v.setWrapText(true);
        VBox b = new VBox(4, k, v);
        b.setStyle("-fx-background-color: rgba(239,68,68,0.1); -fx-border-color: rgba(239,68,68,0.2); -fx-border-width: 1; -fx-background-radius: 10; -fx-border-radius: 10; -fx-padding: 10 14 10 14;");
        b.setMinWidth(300);
        return b;
    }

    private Node pathChip(String label, String value) {
        Label k = new Label(label); k.getStyleClass().add("uppercase-label");
        Label v = new Label(value);
        v.setStyle("-fx-text-fill: #d4d4d4; -fx-font-family: monospace; -fx-font-size: 11px;");
        VBox b = new VBox(3, k, v);
        b.getStyleClass().add("data-chip");
        return b;
    }

    private Node fileRow(TorrentFile f) {
        Label icon = new Label();
        icon.setGraphic(Icons.of(Feather.FILE, 12, "icon-muted"));
        Label name = new Label(f.name() == null ? f.path() : f.name());
        name.getStyleClass().addAll("muted", "mono");
        name.setMaxWidth(420);
        Region sp = new Region();
        HBox.setHgrow(sp, Priority.ALWAYS);
        Label size = new Label(Format.bytes(f.totalLength()));
        size.getStyleClass().addAll("muted-xs", "mono");
        Label pct = new Label(String.format("%.1f%%", f.progress()));
        pct.getStyleClass().addAll("muted-xs", "mono");
        Label sel = new Label(f.selected() ? "NORMAL" : "SKIP");
        sel.getStyleClass().addAll("status-pill", f.selected() ? "status-active" : "status-removed");

        HBox row = new HBox(10, icon, name, sp, size, pct, sel);
        row.setAlignment(Pos.CENTER_LEFT);
        row.setPadding(new Insets(4, 4, 4, 4));
        return row;
    }
}
