package com.smuggler.desktop;

/**
 * Shadow-jar entry point. JavaFX refuses to bootstrap from a class that
 * extends {@code Application} when loaded off the module-path, so we
 * trampoline through this plain class.
 */
public final class Launcher {
    public static void main(String[] args) {
        SmugglerApp.main(args);
    }
}
