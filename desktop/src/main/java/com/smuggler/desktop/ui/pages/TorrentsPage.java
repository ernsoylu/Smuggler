package com.smuggler.desktop.ui.pages;

import com.smuggler.desktop.api.ApiClient;
import com.smuggler.desktop.api.dto.Mule;
import com.smuggler.desktop.api.dto.Torrent;
import com.smuggler.desktop.ui.AppShell;
import com.smuggler.desktop.ui.Format;
import com.smuggler.desktop.ui.Icons;
import com.smuggler.desktop.ui.modals.AddTorrentModal;
import javafx.animation.KeyFrame;
import javafx.animation.Timeline;
import javafx.application.Platform;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.Node;
import javafx.scene.control.Button;
import javafx.scene.control.Label;
import javafx.scene.layout.HBox;
import javafx.scene.layout.Priority;
import javafx.scene.layout.Region;
import javafx.scene.layout.VBox;
import javafx.util.Duration;
import org.kordamp.ikonli.feather.Feather;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class TorrentsPage implements AppShell.Page {

    private final ApiClient api;
    private final VBox root = new VBox(22);
    private final VBox rowsBox = new VBox(8);
    private final HBox filterBar = new HBox(4);
    private final Label emptyLabel = new Label();
    private final Label statusText = new Label();
    private final Map<String, Button> filterButtons = new LinkedHashMap<>();
    private final Map<String, Label> filterCounts = new LinkedHashMap<>();

    private String activeFilter = "all";
    private List<Torrent> torrents = Collections.emptyList();
    private List<Mule> mules = Collections.emptyList();
    private final Timeline poller;

    public TorrentsPage(ApiClient api) {
        this.api = api;
        root.getStyleClass().add("page-content");
        build();

        poller = new Timeline(new KeyFrame(Duration.seconds(2), e -> refresh()));
        poller.setCycleCount(Timeline.INDEFINITE);
        poller.play();
        refresh();
    }

    @Override public Node node() { return root; }

    // ── Build UI ────────────────────────────────────────────────────────────

    private void build() {
        Label title = new Label("Torrents");
        title.getStyleClass().add("page-title");
        Label subtitle = new Label("Manage active downloads across all routing mules.");
        subtitle.getStyleClass().add("page-subtitle");
        VBox titleBlock = new VBox(4, title, subtitle);

        Button add = new Button("Add Torrent", Icons.of(Feather.PLUS, 16, "icon-white"));
        add.getStyleClass().addAll("button", "btn-primary");
        add.setOnAction(e -> openAddModal());

        Region sp = new Region();
        HBox.setHgrow(sp, Priority.ALWAYS);
        HBox header = new HBox(16, titleBlock, sp, add);
        header.setAlignment(Pos.CENTER_LEFT);

        filterBar.getStyleClass().add("filter-tabs");
        filterBar.setAlignment(Pos.CENTER_LEFT);
        for (String f : List.of("all", "active", "paused", "complete", "error")) {
            Button b = new Button();
            b.getStyleClass().add("filter-tab");
            Label n = new Label(capitalize(f));
            Label c = new Label("0");
            c.getStyleClass().add("badge-count");
            HBox g = new HBox(8, n, c); g.setAlignment(Pos.CENTER_LEFT);
            b.setGraphic(g);
            b.setOnAction(e -> setFilter(f));
            filterBar.getChildren().add(b);
            filterButtons.put(f, b);
            filterCounts.put(f, c);
        }
        setFilter("all");

        emptyLabel.getStyleClass().add("muted");
        emptyLabel.setText("Loading torrents…");
        VBox tableWrap = new VBox(0);
        tableWrap.getStyleClass().add("surface");
        tableWrap.setPadding(new Insets(0));

        HBox head = new HBox(12);
        head.setPadding(new Insets(14, 20, 14, 20));
        head.setStyle("-fx-background-color: rgba(23,23,23,0.45); -fx-background-radius: 14 14 0 0; -fx-border-color: rgba(255,255,255,0.06); -fx-border-width: 0 0 1 0;");
        head.setAlignment(Pos.CENTER_LEFT);
        head.getChildren().addAll(
            headerCell("NAME", 360),
            headerCell("STATUS", 90),
            headerCell("PROGRESS", 220),
            headerCell("ETA", 70),
            headerCell("SPEED", 110),
            headerCell("S/P", 60),
            headerCell("MULE", 100)
        );

        rowsBox.setFillWidth(true);
        rowsBox.setPadding(new Insets(6));
        VBox scroll = new VBox(0, rowsBox);
        tableWrap.getChildren().addAll(head, scroll);

        statusText.getStyleClass().add("muted-xs");

        root.getChildren().addAll(header, filterBar, tableWrap, statusText);
        updateEmptyState();
    }

    private Label headerCell(String text, int width) {
        Label l = new Label(text);
        l.getStyleClass().add("uppercase-label");
        l.setMinWidth(width);
        l.setPrefWidth(width);
        return l;
    }

    // ── Data flow ───────────────────────────────────────────────────────────

    private void refresh() {
        api.getAllTorrents().whenComplete((t, err) -> {
            if (err != null) return;
            Platform.runLater(() -> applyTorrents(t));
        });
        api.getMules().whenComplete((m, err) -> {
            if (err == null && m != null) Platform.runLater(() -> this.mules = m);
        });
    }

    private void applyTorrents(List<Torrent> list) {
        this.torrents = list == null ? Collections.emptyList() : list;
        // Update counts
        Map<String, Integer> counts = new LinkedHashMap<>();
        counts.put("all", torrents.size());
        counts.put("active", 0); counts.put("paused", 0);
        counts.put("complete", 0); counts.put("error", 0);
        for (Torrent t : torrents) {
            counts.merge(t.status(), 1, Integer::sum);
        }
        filterCounts.forEach((k, c) -> c.setText(String.valueOf(counts.getOrDefault(k, 0))));

        // Filter + render
        List<Torrent> filtered = new ArrayList<>();
        for (Torrent t : torrents) {
            if (activeFilter.equals("all") || activeFilter.equals(t.status())) {
                filtered.add(t);
            }
        }

        rowsBox.getChildren().clear();
        for (Torrent t : filtered) {
            rowsBox.getChildren().add(new TorrentRow(api, t, this::refresh).node());
        }
        updateEmptyState();
        statusText.setText("Updated — " + torrents.size() + " total, " + filtered.size() + " shown");
    }

    private void updateEmptyState() {
        if (rowsBox.getChildren().isEmpty()) {
            emptyLabel.setText(activeFilter.equals("all")
                ? "No torrents are currently added."
                : "No " + activeFilter + " torrents found.");
            if (!rowsBox.getChildren().contains(emptyLabel)) {
                rowsBox.getChildren().add(emptyLabel);
            }
        }
    }

    private void setFilter(String f) {
        this.activeFilter = f;
        filterButtons.forEach((k, b) -> {
            if (k.equals(f)) {
                if (!b.getStyleClass().contains("active")) b.getStyleClass().add("active");
            } else {
                b.getStyleClass().remove("active");
            }
        });
        applyTorrents(torrents);
    }

    private void openAddModal() {
        api.getMules().whenComplete((m, err) -> Platform.runLater(() -> {
            List<Mule> latest = (err == null && m != null) ? m : mules;
            this.mules = latest;
            new AddTorrentModal(api, latest, this::refresh).show(root.getScene().getWindow());
        }));
    }

    private static String capitalize(String s) {
        if (s == null || s.isEmpty()) return s;
        return Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }
}
