package br.com.estadia.app;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * App Android do Estadia BR (piloto): abre o sistema web em tela cheia, sem barra do navegador,
 * com câmera, GPS e microfone. Links do WhatsApp abrem no próprio WhatsApp do motorista.
 */
public class MainActivity extends Activity {
    static final String URL_INICIAL = "https://estadia-production-1784.up.railway.app/";
    static final String HOST = "estadia-production-1784.up.railway.app";
    static final int REQ_ARQUIVO = 1, REQ_GPS = 2, REQ_MIC = 3;

    WebView web;
    ValueCallback<Uri[]> retornoArquivo;
    Uri fotoCamera;
    GeolocationPermissions.Callback retornoGps;
    String origemGps;
    PermissionRequest pedidoMic;

    @Override
    protected void onCreate(Bundle estado) {
        super.onCreate(estado);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " EstadiaApp/0.1");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, String url) {
                return abrirFora(Uri.parse(url)); // a versão com WebResourceRequest chama esta por padrão
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origem, GeolocationPermissions.Callback cb) {
                if (temPermissao(Manifest.permission.ACCESS_FINE_LOCATION)) { cb.invoke(origem, true, false); return; }
                origemGps = origem; retornoGps = cb;
                requestPermissions(new String[] { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }, REQ_GPS);
            }

            @Override
            public void onPermissionRequest(PermissionRequest pedido) {
                boolean audio = false;
                for (String r : pedido.getResources()) if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) audio = true;
                if (!audio) { pedido.deny(); return; }
                if (temPermissao(Manifest.permission.RECORD_AUDIO)) { pedido.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE }); return; }
                pedidoMic = pedido;
                requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, REQ_MIC);
            }

            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (retornoArquivo != null) retornoArquivo.onReceiveValue(null);
                retornoArquivo = cb;
                fotoCamera = null;
                Intent intent;
                // Campo com "capture" (marcos que exigem foto na hora): abre a câmera direto.
                if (p.isCaptureEnabled() && Build.VERSION.SDK_INT >= 29) {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.Images.Media.DISPLAY_NAME, "estadia_" + System.currentTimeMillis() + ".jpg");
                    cv.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                    fotoCamera = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv);
                    intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                    intent.putExtra(MediaStore.EXTRA_OUTPUT, fotoCamera);
                } else {
                    intent = p.createIntent();
                    if (p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                }
                try { startActivityForResult(intent, REQ_ARQUIVO); }
                catch (ActivityNotFoundException e) { retornoArquivo = null; cb.onReceiveValue(null); return false; }
                return true;
            }
        });

        if (estado != null) web.restoreState(estado);
        else web.loadUrl(URL_INICIAL);
    }

    /** Links de fora do Estadia BR (WhatsApp, telefone, mapas) abrem no app correspondente. */
    boolean abrirFora(Uri u) {
        String esquema = u.getScheme() == null ? "" : u.getScheme();
        if ((esquema.equals("https") || esquema.equals("http")) && HOST.equals(u.getHost())) return false;
        try {
            Intent i = esquema.equals("intent") ? Intent.parseUri(u.toString(), Intent.URI_INTENT_SCHEME) : new Intent(Intent.ACTION_VIEW, u);
            startActivity(i);
        } catch (Exception e) { /* sem app para abrir o link: ignora */ }
        return true;
    }

    boolean temPermissao(String p) { return checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED; }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] res) {
        boolean ok = res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED;
        if (req == REQ_GPS && retornoGps != null) { retornoGps.invoke(origemGps, ok, false); retornoGps = null; }
        if (req == REQ_MIC && pedidoMic != null) {
            if (ok) pedidoMic.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE }); else pedidoMic.deny();
            pedidoMic = null;
        }
    }

    @Override
    protected void onActivityResult(int req, int resultado, Intent dados) {
        if (req != REQ_ARQUIVO || retornoArquivo == null) { super.onActivityResult(req, resultado, dados); return; }
        Uri[] lista = null;
        if (resultado == RESULT_OK) {
            if (fotoCamera != null) lista = new Uri[] { fotoCamera };
            else if (dados != null && dados.getClipData() != null) {
                lista = new Uri[dados.getClipData().getItemCount()];
                for (int i = 0; i < lista.length; i++) lista[i] = dados.getClipData().getItemAt(i).getUri();
            } else if (dados != null && dados.getData() != null) lista = new Uri[] { dados.getData() };
        } else if (fotoCamera != null) {
            getContentResolver().delete(fotoCamera, null, null);
        }
        retornoArquivo.onReceiveValue(lista);
        retornoArquivo = null;
        fotoCamera = null;
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle s) { super.onSaveInstanceState(s); web.saveState(s); }
}
