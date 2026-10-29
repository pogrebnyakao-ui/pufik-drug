package ru.artem.pufik;

import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.media.AudioManager;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.ViewParent;
import android.view.WindowManager;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

/**
 * The Capacitor activity plus what the toddler game needs natively: immersive full screen,
 * screen kept on, media volume keys, portrait on phones, content kept out of cutouts and
 * system bars, and the window.pufikApp contract (back / pause / resume, see README).
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "Pufik";

    /** Game background top colour (--bg-top), same as @color/pufik_background. */
    private static final int BACKGROUND = 0xFFFFF4C9;

    /** Insets the WebView must never be under; IME handled with them (adjustResize). */
    private static final int SAFE_TYPES = WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout();
    private static final int IME_TYPE = WindowInsetsCompat.Type.ime();

    private static final String JS_BACK = "(window.pufikApp&&window.pufikApp.back())===true";
    private static final String JS_PAUSE = "window.pufikApp&&window.pufikApp.pause()";
    private static final String JS_RESUME = "window.pufikApp&&window.pufikApp.resume()";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        applyOrientation(getResources().getConfiguration());
        super.onCreate(savedInstanceState);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setVolumeControlStream(AudioManager.STREAM_MUSIC);
        setUpWebView();
        hideSystemBars();

        // Capacitor 8.5.3 registers no back handler of its own (no @capacitor/app plugin here).
        getOnBackPressedDispatcher().addCallback(
            this,
            new OnBackPressedCallback(true) {
                @Override
                public void handleOnBackPressed() {
                    // The game answers true when it handled back (closed the parent menu) or
                    // ignores it on purpose (toddler playing). Otherwise go to the background.
                    callGame(JS_BACK, result -> {
                        if (!"true".equals(result)) {
                            moveTaskToBack(true);
                        }
                    });
                }
            }
        );
    }

    @Override
    public void onResume() {
        super.onResume();
        hideSystemBars();
        callGame(JS_RESUME, null);
    }

    @Override
    public void onPause() {
        super.onPause();
        callGame(JS_PAUSE, null);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemBars();
        }
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        applyOrientation(newConfig); // e.g. a foldable opened or closed
    }

    /** Phones (smallest width under 600dp) stay portrait; tablets follow the user's rotation setting. */
    private void applyOrientation(Configuration config) {
        int wanted = config.smallestScreenWidthDp < 600
            ? ActivityInfo.SCREEN_ORIENTATION_USER_PORTRAIT
            : ActivityInfo.SCREEN_ORIENTATION_FULL_USER;
        if (getRequestedOrientation() != wanted) {
            setRequestedOrientation(wanted);
        }
    }

    private void hideSystemBars() {
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());
    }

    private WebView webView() {
        return bridge != null ? bridge.getWebView() : null;
    }

    private void setUpWebView() {
        WebView webView = webView();
        if (webView == null) {
            return;
        }
        webView.getSettings().setTextZoom(100);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

        // The only insets handling in the app (Capacitor's SystemBars insets handling is disabled in
        // capacitor.config.json). The WebView's parent is padded by the visible system bars, the
        // display cutout and the keyboard, so on every Android version (including enforced
        // edge-to-edge on Android 15+) the page never sits under them; the padding shows the game
        // background colour. The WebView then gets zero insets, so CSS env(safe-area-inset-*) is 0
        // and nothing is inset twice. Hidden (immersive) bars report zero insets, so they take no space.
        ViewParent parent = webView.getParent();
        if (!(parent instanceof View)) {
            return;
        }
        View container = (View) parent;
        container.setBackgroundColor(BACKGROUND);
        ViewCompat.setOnApplyWindowInsetsListener(container, (v, insets) -> {
            Insets safe = insets.getInsets(SAFE_TYPES);
            Insets ime = insets.getInsets(IME_TYPE);
            v.setPadding(safe.left, safe.top, safe.right, Math.max(safe.bottom, ime.bottom));
            // Not CONSUMED: the WebView must still receive (zero) insets to update its safe area.
            return new WindowInsetsCompat.Builder(insets)
                .setInsets(SAFE_TYPES | IME_TYPE, Insets.NONE)
                .setDisplayCutout(null)
                .build();
        });
        ViewCompat.requestApplyInsets(container);
    }

    /** Runs a window.pufikApp call; safe before the page or the game is ready. */
    private void callGame(String js, ValueCallback<String> done) {
        WebView webView = webView();
        if (webView != null) {
            try {
                webView.evaluateJavascript(js, done);
                return;
            } catch (RuntimeException e) {
                Log.w(TAG, "evaluateJavascript failed", e);
            }
        }
        if (done != null) {
            done.onReceiveValue(null);
        }
    }
}
