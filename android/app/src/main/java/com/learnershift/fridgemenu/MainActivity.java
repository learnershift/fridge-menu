package com.learnershift.fridgemenu;

import android.app.Activity;
import android.graphics.Insets;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowInsets;
import android.window.OnBackInvokedDispatcher;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public final class MainActivity extends Activity {
  private WebView webView;

  @Override public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    webView = new WebView(this);
    WebSettings settings = webView.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(false);
    settings.setUseWideViewPort(true);
    settings.setLoadWithOverviewMode(true);
    settings.setAllowFileAccessFromFileURLs(false);
    settings.setAllowUniversalAccessFromFileURLs(false);
    webView.setWebViewClient(new WebViewClient());

    if (Build.VERSION.SDK_INT >= 35) {
      webView.setOnApplyWindowInsetsListener((view, windowInsets) -> {
        Insets bars = windowInsets.getInsets(WindowInsets.Type.systemBars());
        view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
        return WindowInsets.CONSUMED;
      });
    }
    if (Build.VERSION.SDK_INT >= 33) {
      getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
          OnBackInvokedDispatcher.PRIORITY_DEFAULT,
          this::navigateBackOrFinish);
    }

    webView.loadUrl("file:///android_asset/pwa/index.html");
    setContentView(webView);
  }

  private void navigateBackOrFinish() {
    if (webView.canGoBack()) webView.goBack();
    else finish();
  }

  @Override @SuppressWarnings("deprecation") public void onBackPressed() {
    navigateBackOrFinish();
  }
}
