package com.smuggler.desktop.ui.pages;

import com.smuggler.desktop.api.ApiClient;
import com.smuggler.desktop.api.dto.AppSettings;
import com.smuggler.desktop.ui.AppShell;
import com.smuggler.desktop.ui.Icons;
import javafx.application.Platform;
import javafx.geometry.Pos;
import javafx.scene.Node;
import javafx.scene.control.Button;
import javafx.scene.control.Label;
import javafx.scene.control.TextField;
import javafx.scene.layout.GridPane;
import javafx.scene.layout.HBox;
import javafx.scene.layout.VBox;
import org.kordamp.ikonli.feather.Feather;

public final class SettingsPage implements AppShell.Page {

    private final ApiClient api;
    private final VBox root = new VBox(28);

    private final TextField downloadDir = new TextField();
    private final TextField maxConcurrent = new TextField();
    private final TextField maxDl = new TextField();
    private final TextField maxUl = new TextField();
    private final Label statusLabel = new Label();
    private AppSettings loaded;

    public SettingsPage(ApiClient api) {
        this.api = api;
        root.getStyleClass().add("page-content");
        build();
        refresh();
    }

    @Override public Node node() { return root; }
    @Override public void onShow() { refresh(); }

    private void build() {
        Label title = new Label("Settings");
        title.getStyleClass().add("page-title");
        Label subtitle = new Label("Configure global application preferences.");
        subtitle.getStyleClass().add("page-subtitle");
        VBox header = new VBox(4, title, subtitle);

        HBox panels = new HBox(24, storageCard(), speedCard());
        panels.setFillHeight(true);

        Button save = new Button("Save Changes", Icons.of(Feather.SAVE, 14, "icon-white"));
        save.getStyleClass().addAll("button", "btn-violet");
        save.setOnAction(e -> save());

        statusLabel.getStyleClass().add("muted");

        HBox actions = new HBox(12, save, statusLabel);
        actions.setAlignment(Pos.CENTER_LEFT);

        root.getChildren().addAll(header, panels, actions);
    }

    private Node storageCard() {
        VBox card = new VBox(18);
        card.getStyleClass().add("card");
        HBox.setHgrow(card, javafx.scene.layout.Priority.ALWAYS);
        card.setPrefWidth(420);

        HBox titleRow = new HBox(10,
            Icons.of(Feather.FOLDER, 18, "icon-violet"),
            headerLabel("Storage"));
        titleRow.setAlignment(Pos.CENTER_LEFT);

        downloadDir.setPromptText("/path/to/downloads");
        downloadDir.getStyleClass().add("mono");

        maxConcurrent.setPromptText("5");

        card.getChildren().addAll(
            titleRow,
            fieldBlock("DOWNLOAD DIRECTORY",
                "Absolute path where torrents are saved. Each torrent gets its own subfolder.",
                downloadDir),
            fieldBlock("MAX SIMULTANEOUS DOWNLOADS",
                "Maximum number of active torrents downloading at once per mule.",
                maxConcurrent)
        );
        return card;
    }

    private Node speedCard() {
        VBox card = new VBox(18);
        card.getStyleClass().add("card");
        HBox.setHgrow(card, javafx.scene.layout.Priority.ALWAYS);
        card.setPrefWidth(420);

        HBox titleRow = new HBox(10,
            Icons.of(Feather.ACTIVITY, 18, "icon-blue"),
            headerLabel("Speed Limits"));
        titleRow.setAlignment(Pos.CENTER_LEFT);

        maxDl.setPromptText("0");
        maxDl.getStyleClass().add("mono");
        maxUl.setPromptText("0");
        maxUl.getStyleClass().add("mono");

        HBox dlRow = new HBox(10, maxDl, unit("B/s"));
        dlRow.setAlignment(Pos.CENTER_LEFT);
        HBox.setHgrow(maxDl, javafx.scene.layout.Priority.ALWAYS);

        HBox ulRow = new HBox(10, maxUl, unit("B/s"));
        ulRow.setAlignment(Pos.CENTER_LEFT);
        HBox.setHgrow(maxUl, javafx.scene.layout.Priority.ALWAYS);

        card.getChildren().addAll(
            titleRow,
            fieldBlock("MAX DOWNLOAD SPEED",
                "Global download rate limit in bytes/sec. 0 = unlimited.",
                dlRow),
            fieldBlock("MAX UPLOAD SPEED",
                "Global upload rate limit in bytes/sec. 0 = unlimited.",
                ulRow)
        );
        return card;
    }

    private Label headerLabel(String text) {
        Label l = new Label(text);
        l.getStyleClass().add("h2");
        return l;
    }

    private Label unit(String text) {
        Label l = new Label(text);
        l.getStyleClass().add("muted-xs");
        return l;
    }

    private VBox fieldBlock(String label, String help, Node field) {
        Label l = new Label(label); l.getStyleClass().add("uppercase-label");
        Label h = new Label(help); h.getStyleClass().add("muted-xs");
        h.setWrapText(true);
        VBox v = new VBox(6, l, h, field);
        return v;
    }

    // ── Data ────────────────────────────────────────────────────────────────

    private void refresh() {
        api.getSettings().whenComplete((s, err) -> {
            if (err != null || s == null) return;
            Platform.runLater(() -> {
                loaded = s;
                downloadDir.setText(nullToEmpty(s.downloadDir()));
                maxConcurrent.setText(nullToEmpty(s.maxConcurrentDownloads()));
                maxDl.setText(nullToEmpty(s.maxDownloadSpeed()));
                maxUl.setText(nullToEmpty(s.maxUploadSpeed()));
                statusLabel.setText("");
            });
        });
    }

    private void save() {
        AppSettings payload = new AppSettings(
            downloadDir.getText().trim(),
            maxConcurrent.getText().trim(),
            maxDl.getText().trim(),
            maxUl.getText().trim()
        );
        statusLabel.setText("Saving…");
        api.saveSettings(payload).whenComplete((s, err) -> Platform.runLater(() -> {
            if (err != null) { statusLabel.setText("Failed: " + err.getMessage()); return; }
            statusLabel.setText("Settings saved");
            loaded = s;
        }));
    }

    private String nullToEmpty(String v) { return v == null ? "" : v; }
}
