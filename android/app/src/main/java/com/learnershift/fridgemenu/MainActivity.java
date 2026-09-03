package com.learnershift.fridgemenu;

import android.app.Activity;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowInsets;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebViewAssetLoader;
import java.io.ByteArrayInputStream;

public final class MainActivity extends Activity {
  private static final String APP_HOST = "appassets.androidplatform.net";
  private static final String APP_ORIGIN = "https:" + "//" + APP_HOST;
  private static final String APP_PATH = "/assets/pwa/";
  private static final String APP_ENTRY = APP_ORIGIN + APP_PATH + "index.html";
  private WebView webView;
  private OnBackInvokedCallback backCallback;
  private boolean backCallbackRegistered;

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
    WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
        .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
        .build();
    webView.setWebViewClient(new WebViewClient() {
      @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        return !isAllowedAppUrl(request.getUrl().toString());
      }

      @Override @SuppressWarnings("deprecation") public boolean shouldOverrideUrlLoading(WebView view, String url) {
        return !isAllowedAppUrl(url);
      }

      @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        return isAllowedAppUrl(request.getUrl().toString())
            ? assetLoader.shouldInterceptRequest(request.getUrl())
            : emptyResponse();
      }

      @Override @SuppressWarnings("deprecation") public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
        return isAllowedAppUrl(url)
            ? assetLoader.shouldInterceptRequest(Uri.parse(url))
            : emptyResponse();
      }

      @Override public void onPageFinished(WebView view, String url) {
        syncBackCallback();
      }
    });

    if (Build.VERSION.SDK_INT >= 35) {
      webView.setOnApplyWindowInsetsListener((view, windowInsets) -> {
        Insets bars = windowInsets.getInsets(
            WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
        view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
        return windowInsets;
      });
    }
    if (Build.VERSION.SDK_INT >= 33) {
      backCallback = this::navigateWebHistory;
    }

    webView.loadUrl(APP_ENTRY);
    setContentView(webView);
  }

  private static boolean isAllowedAppUrl(String rawUrl) {
    try {
      Uri uri = Uri.parse(rawUrl);
      if (!"https".equals(uri.getScheme()) || !APP_HOST.equals(uri.getAuthority())) return false;
      String encodedPath = uri.getEncodedPath();
      if (encodedPath == null || encodedPath.indexOf('%') >= 0) return false;
      String path = Uri.decode(encodedPath);
      if (!path.startsWith(APP_PATH) || path.indexOf('\\') >= 0 || path.indexOf('%') >= 0) return false;
      for (String segment : path.substring(APP_PATH.length()).split("/")) {
        if (".".equals(segment) || "..".equals(segment)) return false;
      }
      return true;
    } catch (RuntimeException ignored) {
      return false;
    }
  }

  private static WebResourceResponse emptyResponse() {
    return new WebResourceResponse(
        "text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]));
  }

  private void syncBackCallback() {
    if (Build.VERSION.SDK_INT < 33 || backCallback == null) return;
    boolean shouldRegister = webView.canGoBack();
    if (shouldRegister && !backCallbackRegistered) {
      getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
          OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
      backCallbackRegistered = true;
    } else if (!shouldRegister && backCallbackRegistered) {
      getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
      backCallbackRegistered = false;
    }
  }

  private void navigateWebHistory() {
    if (webView.canGoBack()) webView.goBack();
    else syncBackCallback();
  }

  @Override @SuppressWarnings("deprecation") public void onBackPressed() {
    if (webView.canGoBack()) webView.goBack();
    else super.onBackPressed();
  }

  @Override protected void onDestroy() {
    if (Build.VERSION.SDK_INT >= 33 && backCallbackRegistered) {
      getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
      backCallbackRegistered = false;
    }
    webView.destroy();
    super.onDestroy();
  }
}
