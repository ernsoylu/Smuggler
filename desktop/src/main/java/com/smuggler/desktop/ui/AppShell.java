package com.smuggler.desktop.ui;

import com.smuggler.desktop.api.ApiClient;
import com.smuggler.desktop.ui.pages.ConfigsPage;
import com.smuggler.desktop.ui.pages.MulesPage;
import com.smuggler.desktop.ui.pages.SettingsPage;
import com.smuggler.desktop.ui.pages.TorrentsPage;
import javafx.geometry.Pos;
import javafx.scene.Node;
import javafx.scene.control.Button;
import javafx.scene.control.Label;
import javafx.scene.control.ScrollPane;
import javafx.scene.layout.BorderPane;
import javafx.scene.layout.HBox;
import javafx.scene.layout.StackPane;
import org.kordamp.ikonli.feather.Feather;
import org.kordamp.ikonli.javafx.FontIcon;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Top-level shell: top navbar with brand + tabs, switching content region,
 * persistent status footer. Mirrors the structure of web/src/App.tsx.
 */
public final class AppShell {

    private final ApiClient api;
    private final BorderPane root = new BorderPane();
    private final StackPane content = new StackPane();
    private final Map<String, Page> pages = new LinkedHashMap<>();
    private final Map<String, Button> navButtons = new LinkedHashMap<>();
    private final StatusFooter footer;
    private String current;

    public AppShell(ApiClient api) {
        this.api = api;
        root.getStyleClass().add("root");
        root.setTop(buildNavbar());
        root.setCenter(content);
        this.footer = new StatusFooter(api);
        root.setBottom(footer.node());

        registerPage("torrents", "Torrents", Feather.GRID,    new TorrentsPage(api));
        registerPage("mules",    "Mules",    Feather.SERVER,  new MulesPage(api));
        registerPage("configs",  "Configs",  Feather.KEY,     new ConfigsPage(api));
        registerPage("settings", "Settings", Feather.SETTINGS,new SettingsPage(api));

        show("torrents");
    }

    public BorderPane node() { return root; }

    public void dispose() {
        if (footer != null) footer.stop();
    }

    public interface Page {
        Node node();
        default void onShow() {}
        default void onHide() {}
    }

    // ── Navbar ──────────────────────────────────────────────────────────────

    private HBox buildNavbar() {
        HBox bar = new HBox(28);
        bar.getStyleClass().add("navbar");
        bar.setAlignment(Pos.CENTER_LEFT);

        HBox brand = new HBox(10);
        brand.setAlignment(Pos.CENTER_LEFT);
        StackPane mark = new StackPane(new Label("🫏"));
        mark.getStyleClass().add("brand-mark");
        Label name = new Label("SMUGGLER");
        name.getStyleClass().add("brand-text");
        brand.getChildren().addAll(mark, name);

        HBox tabs = new HBox(6);
        tabs.setAlignment(Pos.CENTER_LEFT);
        bar.getChildren().addAll(brand, tabs);

        // Defer population until registerPage fills the map; capture reference
        root.sceneProperty().addListener((obs, o, s) -> {});
        this.navBox = tabs;
        return bar;
    }

    private HBox navBox;

    private void registerPage(String key, String label, Feather icon, Page page) {
        pages.put(key, page);
        FontIcon fi = new FontIcon(icon); fi.setIconSize(16);
        Button b = new Button(label, fi);
        b.getStyleClass().add("nav-button");
        b.setOnAction(e -> show(key));
        navButtons.put(key, b);
        navBox.getChildren().add(b);
    }

    private void show(String key) {
        if (key.equals(current)) return;
        Page next = pages.get(key);
        if (next == null) return;
        if (current != null) pages.get(current).onHide();

        content.getChildren().setAll(wrap(next.node()));

        navButtons.forEach((k, b) -> {
            if (k.equals(key)) {
                if (!b.getStyleClass().contains("active")) b.getStyleClass().add("active");
            } else {
                b.getStyleClass().remove("active");
            }
        });
        current = key;
        next.onShow();
    }

    private Node wrap(Node pageRoot) {
        ScrollPane sp = new ScrollPane(pageRoot);
        sp.setFitToWidth(true);
        sp.setPannable(false);
        sp.setHbarPolicy(ScrollPane.ScrollBarPolicy.NEVER);
        sp.getStyleClass().add("page-scroll");
        return sp;
    }
}
