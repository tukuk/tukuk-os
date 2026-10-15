package org.tukuk.chat;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ProgressBar;

import java.util.ArrayList;

/**
 * Pembungkus WebView untuk T Chat (https://tukuk.org/apps/chat).
 *
 * Satu Activity sahaja — tiada AndroidX/Gradle supaya boleh dibina terus
 * dengan aapt2 + javac + d8 + apksigner. Ia mengaktifkan ciri yang aplikasi
 * chat perlukan: simpanan setempat (localStorage utk token sesi), kebenaran
 * kamera/mikrofon untuk panggilan WebRTC, pemilihan fail untuk lampiran,
 * video skrin penuh, dan navigasi belakang.
 */
public class MainActivity extends Activity {
  private static final String START_URL = "https://tukuk.org/apps/chat";
  private static final String HOST = "tukuk.org";
  private static final int REQ_FILE = 101;
  private static final int REQ_PERM = 42;

  private WebView web;
  private FrameLayout root;
  private ProgressBar bar;
  private ValueCallback<Uri[]> fileCallback;
  private PermissionRequest pendingGrant;
  private View customView;
  private WebChromeClient.CustomViewCallback customCb;

  @Override
  protected void onCreate(Bundle saved) {
    super.onCreate(saved);
    requestWindowFeature(Window.FEATURE_NO_TITLE);
    try { WebView.setWebContentsDebuggingEnabled(true); } catch (Throwable ignore) { }
    try {
      getWindow().addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
      getWindow().setStatusBarColor(Color.parseColor("#0f1115"));
      getWindow().setNavigationBarColor(Color.parseColor("#0f1115"));
    } catch (Exception ignore) { /* peranti lama tiada bar berwarna */ }

    root = new FrameLayout(this);
    root.setBackgroundColor(Color.parseColor("#0f1115"));

    try {
      web = new WebView(this);
    } catch (Throwable t) {
      // Sesetengah ROM membuang/mematikan enjin WebView → `new WebView` terus
      // crash. Ubah crash senyap menjadi arahan yang boleh difahami pengguna.
      showFatalNoWebView(t);
      return;
    }
    root.addView(web, new FrameLayout.LayoutParams(-1, -1));

    bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
    bar.setMax(100);
    bar.setVisibility(View.GONE);
    root.addView(bar, new FrameLayout.LayoutParams(-1, dp(3)));

    setContentView(root);

    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);                         // localStorage — token sesi T Chat
    s.setMediaPlaybackRequiresUserGesture(false);         // dering/notif boleh auto-main
    s.setAllowFileAccess(false);
    s.setUseWideViewPort(true);
    s.setLoadWithOverviewMode(true);
    s.setCacheMode(WebSettings.LOAD_DEFAULT);
    s.setTextZoom(100);
    s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
    try { CookieManager.getInstance().setAcceptThirdPartyCookies(web, true); } catch (Exception ignore) {}

    web.setWebViewClient(new WebViewClient() {
      @Override
      public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
        Uri u = r.getUrl();
        String scheme = u.getScheme();
        String host = u.getHost();
        boolean webScheme = "http".equals(scheme) || "https".equals(scheme);
        // kekal dalam aplikasi untuk tukuk.org (+ subdomain); lain => hantar ke apl luar
        if (webScheme && host != null && (host.equals(HOST) || host.endsWith("." + HOST))) return false;
        if (webScheme || "mailto".equals(scheme) || "tel".equals(scheme) || "intent".equals(scheme)) {
          openExternal(u);
          return true;
        }
        return false;
      }

      @Override
      public void onPageStarted(WebView v, String url, Bitmap favicon) {
        bar.setVisibility(View.VISIBLE);
        bar.setProgress(0);
      }

      @Override
      public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
        if (r.isForMainFrame()) showOffline();
      }
    });

    web.setWebChromeClient(new WebChromeClient() {
      @Override
      public void onProgressChanged(WebView v, int p) {
        bar.setProgress(p);
        if (p >= 100) bar.setVisibility(View.GONE);
      }

      @Override
      public void onPermissionRequest(final PermissionRequest req) {
        boolean needCam = false, needMic = false;
        for (String res : req.getResources()) {
          if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)) needCam = true;
          if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)) needMic = true;
        }
        ArrayList<String> ask = new ArrayList<>();
        if (needCam && checkSelfPermission(android.Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED)
          ask.add(android.Manifest.permission.CAMERA);
        if (needMic && checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
          ask.add(android.Manifest.permission.RECORD_AUDIO);
        if (!ask.isEmpty()) {
          pendingGrant = req;
          requestPermissions(ask.toArray(new String[0]), REQ_PERM);
        } else {
          runOnUiThread(new Runnable() { public void run() { req.grant(req.getResources()); } });
        }
      }

      @Override
      public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        fileCallback = cb;
        Intent i = new Intent(Intent.ACTION_GET_CONTENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        try {
          startActivityForResult(Intent.createChooser(i, "Pilih lampiran"), REQ_FILE);
        } catch (Exception e) {
          fileCallback = null;
          return false;
        }
        return true;
      }

      @Override
      public void onShowCustomView(View view, CustomViewCallback cb) {
        if (customView != null) { cb.onCustomViewHidden(); return; }
        customView = view;
        customCb = cb;
        root.addView(view, new FrameLayout.LayoutParams(-1, -1));
        web.setVisibility(View.GONE);
        bar.setVisibility(View.GONE);
      }

     @Override
      public void onHideCustomView() {
        hideFullscreen();
      }
    });

    web.loadUrl(START_URL);
  }

  // Keluar mod skrin penuh video — digunakan ChromeClient dan butang belakang.
  private void hideFullscreen() {
    if (customView == null) return;
    root.removeView(customView);
    customView.setVisibility(View.GONE);
    customView = null;
    web.setVisibility(View.VISIBLE);
    try { if (customCb != null) customCb.onCustomViewHidden(); } catch (Exception ignore) {}
    customCb = null;
  }

  @Override
  public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
    super.onRequestPermissionsResult(code, perms, results);
    if (code == REQ_PERM && pendingGrant != null) {
      boolean ok = results.length > 0;
      for (int r : results) if (r != PackageManager.PERMISSION_GRANTED) ok = false;
      if (ok) pendingGrant.grant(pendingGrant.getResources()); else pendingGrant.deny();
      pendingGrant = null;
    }
  }

  @Override
  protected void onActivityResult(int code, int result, Intent data) {
    super.onActivityResult(code, result, data);
    if (code != REQ_FILE || fileCallback == null) return;
    Uri[] uris = null;
    if (result == RESULT_OK && data != null) {
      if (data.getClipData() != null) {
        android.content.ClipData clip = data.getClipData();
        uris = new Uri[clip.getItemCount()];
        for (int i = 0; i < clip.getItemCount(); i++) uris[i] = clip.getItemAt(i).getUri();
      } else if (data.getData() != null) {
        uris = new Uri[] { data.getData() };
      }
    }
    fileCallback.onReceiveValue(uris);
    fileCallback = null;
  }

  private void openExternal(Uri u) {
    try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignore) {}
  }

  private void showOffline() {
    String html = "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>"
        + "<div style='font-family:system-ui,sans-serif;background:#0f1115;color:#e8edf5;height:100vh;"
        + "display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;box-sizing:border-box'>"
        + "<div style='font-size:3rem'>📡</div><h2>Tiada sambungan</h2>"
        + "<p style='opacity:.8'>T Chat perlu internet untuk memuat.</p>"
        + "<button onclick='location.reload()' style='margin-top:18px;padding:10px 24px;border-radius:10px;"
        + "border:none;background:#65aadd;color:#08101f;font-size:1rem;font-weight:600'>Cuba lagi</button></div>";
    web.loadDataWithBaseURL(START_URL, html, "text/html", "utf-8", null);
  }

  // Papar arahan bila enjin WebView langsung tiada/gagal — elak skrin kosong/crash.
  private void showFatalNoWebView(Throwable t) {
    android.widget.TextView tv = new android.widget.TextView(this);
    tv.setTextColor(Color.parseColor("#e8edf5"));
    tv.setBackgroundColor(Color.parseColor("#0f1115"));
    tv.setPadding(dp(28), dp(28), dp(28), dp(28));
    tv.setTextSize(15);
    tv.setText("T Chat memerlukan enjin WebView Android untuk berfungsi.\n\n"
        + "Sila pasang atau kemas kini \u201cAndroid System WebView\u201d daripada Google Play, "
        + "kemudian buka semula aplikasi ini.\n\n"
        + "Butiran: " + (t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage()));
    setContentView(tv);
  }

  @Override
  public void onBackPressed() {
    if (customView != null) { hideFullscreen(); return; }
    if (web.canGoBack()) web.goBack(); else super.onBackPressed();
  }

  private int dp(int v) { return Math.round(getResources().getDisplayMetrics().density * v); }
}
