package com.smuggler.desktop.ui.modals;

import javafx.scene.Node;
import javafx.scene.Scene;
import javafx.scene.input.KeyCode;
import javafx.scene.layout.StackPane;
import javafx.stage.Modality;
import javafx.stage.Stage;
import javafx.stage.StageStyle;
import javafx.stage.Window;

/** Stage-based dark modal wrapper; applies app.css and centers on owner. */
public class Modal {
    private final Stage stage = new Stage();
    private final StackPane backdrop;

    public Modal(Node content, int prefWidth, int prefHeight) {
        content.getStyleClass().add("modal-card");
        backdrop = new StackPane(content);
        backdrop.setStyle("-fx-background-color: #0a0a0a;");
        backdrop.setPrefSize(prefWidth, prefHeight);
        backdrop.setPadding(new javafx.geometry.Insets(20));

        Scene scene = new Scene(backdrop, prefWidth, prefHeight);
        scene.setOnKeyPressed(e -> { if (e.getCode() == KeyCode.ESCAPE) close(); });
        String css = getClass().getResource("/css/app.css").toExternalForm();
        scene.getStylesheets().add(css);

        stage.initModality(Modality.APPLICATION_MODAL);
        stage.initStyle(StageStyle.DECORATED);
        stage.setTitle("Smuggler");
        stage.setScene(scene);
        stage.setWidth(prefWidth);
        stage.setHeight(prefHeight);
        stage.setMinWidth(prefWidth);
        stage.setMinHeight(prefHeight);
    }

    public void showAnd(Window owner) {
        if (owner != null) stage.initOwner(owner);
        stage.sizeToScene();
        stage.centerOnScreen();
        stage.showAndWait();
    }

    public void close() { stage.close(); }

    public Stage stage() { return stage; }
}
