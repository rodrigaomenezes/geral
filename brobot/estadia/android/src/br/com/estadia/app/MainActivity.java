package br.com.estadia.app;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.app.PendingIntent;
import android.telephony.SmsManager;
import java.util.ArrayList;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * App Android do Estadia BR (piloto): abre o sistema web em tela cheia, sem barra do navegador,
 * com câmera, GPS e microfone. Links do WhatsApp abrem no próprio WhatsApp do motorista.
 * O SMS para a portaria sai pelo chip do motorista sem sair da tela (ponte EstadiaNativo),
 * e a operadora avisa quando foi enviado e entregue.
 */
public class MainActivity extends Activity {
    static final String URL_INICIAL = "https://estadia-production-1784.up.railway.app/";
    static final String HOST = "estadia-production-1784.up.railway.app";
    static final int REQ_ARQUIVO = 1, REQ_GPS = 2, REQ_MIC = 3, REQ_SMS = 4;
    static MainActivity atual;

    WebView web;
    ValueCallback<Uri[]> retornoArquivo;
    Uri fotoCamera;
    GeolocationPermissions.Callback retornoGps;
    String origemGps;
    PermissionRequest pedidoMic;
    String[] smsPendente; // {mensagemId, numero, texto} aguardando a permissão
    int seqSms = 0;

    @Override
    protected void onCreate(Bundle estado) {
        super.onCreate(estado);
        atual = this;
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

            @Override
            public void onPageFinished(WebView v, String url) { entregarGuardados(); }
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

        web.addJavascriptInterface(new Ponte(), "EstadiaNativo");

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

    /** Ponte chamada pelo sistema web. Só existe neste app, nunca no navegador. */
    class Ponte {
        @JavascriptInterface public boolean podeSms() { return getPackageManager().hasSystemFeature(PackageManager.FEATURE_TELEPHONY); }
        @JavascriptInterface public void enviarSms(final String id, final String numero, final String texto) {
            runOnUiThread(new Runnable() { public void run() {
                if (temPermissao(Manifest.permission.SEND_SMS)) enviarSmsAgora(id, numero, texto);
                else { smsPendente = new String[] { id, numero, texto }; requestPermissions(new String[] { Manifest.permission.SEND_SMS }, REQ_SMS); }
            } });
        }
    }

    void enviarSmsAgora(String id, String numero, String texto) {
        try {
            SmsManager sms = SmsManager.getDefault();
            ArrayList<String> partes = sms.divideMessage(texto);
            ArrayList<PendingIntent> enviados = new ArrayList<PendingIntent>(), entregues = new ArrayList<PendingIntent>();
            for (int i = 0; i < partes.size(); i++) {
                // Só a última parte avisa o sistema (uma mensagem longa vai em várias partes).
                boolean ultima = i == partes.size() - 1;
                enviados.add(ultima ? retorno(id, "enviado") : null);
                entregues.add(ultima ? retorno(id, "entregue") : null);
            }
            sms.sendMultipartTextMessage(numero, null, partes, enviados, entregues);
        } catch (Exception e) {
            avisarWeb(id, "falha", "não foi possível usar o chip (" + e.getClass().getSimpleName() + ")");
        }
    }

    PendingIntent retorno(String id, String etapa) {
        Intent i = new Intent(this, SmsRetorno.class).setAction("br.com.estadia.SMS_" + etapa).putExtra("id", id).putExtra("etapa", etapa);
        return PendingIntent.getBroadcast(this, ++seqSms, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Repassa ao sistema web o resultado informado pela operadora. */
    void avisarWeb(String id, String status, String erro) {
        final String js = "window.estadiaSmsRetorno && window.estadiaSmsRetorno(" + jsStr(id) + "," + jsStr(status) + "," + (erro == null ? "null" : jsStr(erro)) + ")";
        runOnUiThread(new Runnable() { public void run() { web.evaluateJavascript(js, null); } });
    }

    /** Avisos da operadora que chegaram com o app fechado. */
    static void guardar(Context ctx, String id, String status, String erro) {
        SharedPreferences p = ctx.getSharedPreferences("sms", MODE_PRIVATE);
        p.edit().putString(id + "|" + status, erro == null ? "" : erro).apply();
    }

    void entregarGuardados() {
        SharedPreferences p = getSharedPreferences("sms", MODE_PRIVATE);
        for (java.util.Map.Entry<String, ?> e : p.getAll().entrySet()) {
            String[] k = e.getKey().split("\\|", 2);
            String erro = String.valueOf(e.getValue());
            if (k.length == 2) avisarWeb(k[0], k[1], erro.isEmpty() ? null : erro);
        }
        p.edit().clear().apply();
    }

    static String jsStr(String s) {
        StringBuilder b = new StringBuilder("'");
        for (char c : s.toCharArray()) { if (c == '\\' || c == '\'') b.append('\\'); if (c >= 32 && c != '<') b.append(c); }
        return b.append("'").toString();
    }

    boolean temPermissao(String p) { return checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED; }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] res) {
        boolean ok = res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED;
        if (req == REQ_GPS && retornoGps != null) { retornoGps.invoke(origemGps, ok, false); retornoGps = null; }
        if (req == REQ_SMS && smsPendente != null) {
            String[] p = smsPendente; smsPendente = null;
            if (ok) enviarSmsAgora(p[0], p[1], p[2]); else avisarWeb(p[0], "falha", "permissão de SMS negada");
        }
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
    protected void onDestroy() { if (atual == this) atual = null; super.onDestroy(); }

    @Override
    protected void onSaveInstanceState(Bundle s) { super.onSaveInstanceState(s); web.saveState(s); }
}
