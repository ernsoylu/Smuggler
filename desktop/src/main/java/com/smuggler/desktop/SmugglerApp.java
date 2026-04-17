package com.smuggler.desktop;

import atlantafx.base.theme.PrimerDark;
import com.smuggler.desktop.api.ApiClient;
import com.smuggler.desktop.ui.AppShell;
import javafx.application.Application;
import javafx.scene.Scene;
import javafx.stage.Stage;

public class SmugglerApp extends Application {

    private AppShell shell;

    @Override
    public void start(Stage stage) {
        Application.setUserAgentStylesheet(new PrimerDark().getUserAgentStylesheet());

        ApiClient api = new ApiClient();
        shell = new AppShell(api);

        Scene scene = new Scene(shell.node(), 1280, 820);
        scene.getStylesheets().add(
            getClass().getResource("/css/app.css").toExternalForm()
        );

        stage.setTitle("Smuggler");
        stage.setScene(scene);
        stage.setOnCloseRequest(e -> shutdown());
        stage.show();
    }

    private void shutdown() {
        if (shell != null) shell.dispose();
    }

    public static void main(String[] args) {
        launch(args);
    }
}
