package br.com.menezesgestao.guiabrasil;

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
import android.speech.tts.TextToSpeech;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.util.Locale;
import org.json.JSONObject;

/**
 * App Android do GuIA Brasil (piloto): abre o app web em tela cheia e acrescenta o que o navegador não faz com a
 * tela bloqueada: GPS em segundo plano (GuiaServico), voz do sistema e notificações nativas.
 * A ponte `GuiaNativo` só existe aqui; o JavaScript (plataforma.js) usa a ponte quando ela existe.
 */
public class MainActivity extends Activity implements TextToSpeech.OnInitListener {
    static final String URL_INICIAL = "https://geral-production.up.railway.app/";
    static final String HOST = "geral-production.up.railway.app";
    static final int REQ_ARQUIVO = 1, REQ_GPS_WEB = 2, REQ_GPS_CAMINHADA = 3;
    static MainActivity atual;
    static boolean visivel = false;

    WebView web;
    TextToSpeech tts;
    boolean ttsPronto = false;
    ValueCallback<Uri[]> retornoArquivo;
    Uri fotoCamera;
    GeolocationPermissions.Callback retornoGps;
    String origemGps;

    @Override
    protected void onCreate(Bundle estado) {
        super.onCreate(estado);
        atual = this;
        Notificacoes.criarCanais(this);
        tts = new TextToSpeech(this, this);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " GuIABrasilApp/0.3");
        prioridadeAlta(web);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, String url) { return abrirFora(Uri.parse(url)); }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origem, GeolocationPermissions.Callback cb) {
                if (temPermissao(Manifest.permission.ACCESS_FINE_LOCATION)) { cb.invoke(origem, true, false); return; }
                origemGps = origem; retornoGps = cb;
                requestPermissions(new String[] { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }, REQ_GPS_WEB);
            }

            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (retornoArquivo != null) retornoArquivo.onReceiveValue(null);
                retornoArquivo = cb;
                fotoCamera = null;
                Intent intent;
                // Campo "Tirar foto" (capture): abre a câmera direto.
                if (p.isCaptureEnabled() && Build.VERSION.SDK_INT >= 29) {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.Images.Media.DISPLAY_NAME, "guia_" + System.currentTimeMillis() + ".jpg");
                    cv.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                    fotoCamera = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv);
                    intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                    intent.putExtra(MediaStore.EXTRA_OUTPUT, fotoCamera);
                } else {
                    intent = p.createIntent();
                }
                try { startActivityForResult(intent, REQ_ARQUIVO); }
                catch (ActivityNotFoundException e) { retornoArquivo = null; cb.onReceiveValue(null); return false; }
                return true;
            }
        });

        web.addJavascriptInterface(new Ponte(), "GuiaNativo");
        if (estado != null) web.restoreState(estado);
        else web.loadUrl(URL_INICIAL);
        abrirAlertaDa(getIntent());
    }

    /** Pede ao Android para não matar a página quando o app vai para segundo plano (API 26+, por reflexão). */
    static void prioridadeAlta(WebView w) {
        if (Build.VERSION.SDK_INT < 26) return;
        try { WebView.class.getMethod("setRendererPriorityPolicy", int.class, boolean.class).invoke(w, 2, false); }
        catch (Exception e) { /* sem efeito em versões sem a API */ }
    }

    @Override
    public void onInit(int status) {
        if (status != TextToSpeech.SUCCESS) return;
        int r = tts.setLanguage(new Locale("pt", "BR"));
        ttsPronto = r != TextToSpeech.LANG_MISSING_DATA && r != TextToSpeech.LANG_NOT_SUPPORTED;
        tts.setSpeechRate(1.02f);
    }

    /** Links de fora do app (mapas, sites) abrem no app correspondente. */
    boolean abrirFora(Uri u) {
        String esquema = u.getScheme() == null ? "" : u.getScheme();
        if ((esquema.equals("https") || esquema.equals("http")) && HOST.equals(u.getHost())) return false;
        try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) { /* sem app para o link */ }
        return true;
    }

    /** Ponte chamada pelo JavaScript (plataforma.js). Chamadas chegam numa thread da WebView. */
    class Ponte {
        @JavascriptInterface public boolean emPrimeiroPlano() { return visivel; }

        @JavascriptInterface public void iniciarAcompanhamento() {
            runOnUiThread(new Runnable() { public void run() {
                if (temPermissao(Manifest.permission.ACCESS_FINE_LOCATION)) GuiaServico.iniciar(MainActivity.this);
                else requestPermissions(new String[] { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }, REQ_GPS_CAMINHADA);
            } });
        }

        @JavascriptInterface public void pararAcompanhamento() { GuiaServico.parar(MainActivity.this); }

        @JavascriptInterface public void falar(String texto) {
            if (ttsPronto && texto != null) tts.speak(texto, TextToSpeech.QUEUE_FLUSH, null, "guia");
        }
        @JavascriptInterface public void pararFala() { if (ttsPronto) tts.stop(); }
        @JavascriptInterface public boolean falando() { return ttsPronto && tts.isSpeaking(); }

        /** {id, tipo, titulo, texto}: só notifica se o app não estiver na frente da pessoa. */
        @JavascriptInterface public void notificar(String json) {
            if (visivel) return;
            try {
                JSONObject a = new JSONObject(json);
                Notificacoes.alerta(MainActivity.this, a.getString("id"), a.optString("tipo"), a.optString("titulo"), a.optString("texto"));
            } catch (Exception e) { /* alerta malformado: ignora */ }
        }
    }

    /** Posição vinda do GuiaServico: vai para o companheiro em JavaScript. */
    static void entregarPosicao(double lat, double lng, float precisao) {
        final MainActivity a = atual;
        if (a == null) return; // a tela foi destruída: sem JavaScript para decidir (ver limitações no README)
        final String js = String.format(Locale.US, "window.guiaReceberPosicao && window.guiaReceberPosicao({lat:%.7f,lng:%.7f,precisao:%.1f})", lat, lng, precisao);
        a.runOnUiThread(new Runnable() { public void run() { a.web.evaluateJavascript(js, null); } });
    }

    /** A pessoa tocou "Encerrar caminhada" na notificação, ou o GPS foi negado. */
    static void avisarEncerrado() {
        final MainActivity a = atual;
        if (a == null) return;
        a.runOnUiThread(new Runnable() { public void run() {
            a.web.evaluateJavascript("window.guiaAcompanhamentoEncerrado && window.guiaAcompanhamentoEncerrado()", null);
        } });
    }

    void abrirAlertaDa(Intent i) {
        if (i == null || i.getStringExtra("alerta") == null) return;
        final String js = "window.guiaAbrirAlerta && window.guiaAbrirAlerta(" + JSONObject.quote(i.getStringExtra("alerta")) + ")";
        web.postDelayed(new Runnable() { public void run() { web.evaluateJavascript(js, null); } }, 400);
    }

    @Override
    protected void onNewIntent(Intent i) { super.onNewIntent(i); setIntent(i); abrirAlertaDa(i); }

    boolean temPermissao(String p) { return checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED; }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] res) {
        boolean ok = res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED;
        if (req == REQ_GPS_WEB && retornoGps != null) { retornoGps.invoke(origemGps, ok, false); retornoGps = null; }
        if (req == REQ_GPS_CAMINHADA) { if (ok) GuiaServico.iniciar(this); else avisarEncerrado(); }
    }

    @Override
    protected void onActivityResult(int req, int resultado, Intent dados) {
        if (req != REQ_ARQUIVO || retornoArquivo == null) { super.onActivityResult(req, resultado, dados); return; }
        Uri[] lista = null;
        if (resultado == RESULT_OK) {
            if (fotoCamera != null) lista = new Uri[] { fotoCamera };
            else if (dados != null && dados.getData() != null) lista = new Uri[] { dados.getData() };
        } else if (fotoCamera != null) {
            getContentResolver().delete(fotoCamera, null, null);
        }
        retornoArquivo.onReceiveValue(lista);
        retornoArquivo = null;
        fotoCamera = null;
    }

    // A WebView NÃO é pausada (sem web.onPause()): com o serviço ativo, o JavaScript segue decidindo os alertas.
    @Override protected void onResume() { super.onResume(); visivel = true; }
    @Override protected void onPause() { visivel = false; super.onPause(); }

    /** Voltar na tela inicial manda o app para trás em vez de fechar: a caminhada continua. */
    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else moveTaskToBack(true);
    }

    @Override
    protected void onDestroy() {
        if (isFinishing()) GuiaServico.parar(this); // fechado de vez: encerra a caminhada
        if (tts != null) tts.shutdown();
        if (atual == this) atual = null;
        super.onDestroy();
    }

    @Override
    protected void onSaveInstanceState(Bundle s) { super.onSaveInstanceState(s); web.saveState(s); }
}
