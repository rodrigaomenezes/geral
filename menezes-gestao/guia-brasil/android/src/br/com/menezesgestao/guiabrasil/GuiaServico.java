package br.com.menezesgestao.guiabrasil;

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Looper;

/**
 * Serviço em primeiro plano da caminhada: mantém o GPS ligado com a tela bloqueada e entrega cada posição ao
 * companheiro (JavaScript, nucleo.js) pela MainActivity. Não decide nada: as regras ficam num lugar só.
 */
public class GuiaServico extends Service implements LocationListener {
    static final String ACAO_PARAR = "br.com.menezesgestao.guiabrasil.PARAR";
    static final long INTERVALO_MS = 4000;   // GPS a cada ~4 s
    static final float DISTANCIA_M = 5f;     // ou a cada 5 m andados
    static boolean ativo = false;

    LocationManager gps;

    static void iniciar(Context c) {
        Intent i = new Intent(c, GuiaServico.class);
        if (Build.VERSION.SDK_INT >= 26) {
            try { Context.class.getMethod("startForegroundService", Intent.class).invoke(c, i); return; }
            catch (Exception e) { /* cai no startService */ }
        }
        c.startService(i);
    }

    static void parar(Context c) { c.stopService(new Intent(c, GuiaServico.class)); }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACAO_PARAR.equals(intent.getAction())) {
            MainActivity.avisarEncerrado();
            stopSelf();
            return START_NOT_STICKY;
        }
        startForeground(Notificacoes.ID_SERVICO, Notificacoes.caminhada(this));
        if (!ativo) ligarGps();
        ativo = true;
        return START_NOT_STICKY; // se o sistema matar o processo, não volta sozinho: a pessoa reabre o app
    }

    void ligarGps() {
        gps = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        try {
            if (gps.isProviderEnabled(LocationManager.GPS_PROVIDER))
                gps.requestLocationUpdates(LocationManager.GPS_PROVIDER, INTERVALO_MS, DISTANCIA_M, this, Looper.getMainLooper());
            if (gps.isProviderEnabled(LocationManager.NETWORK_PROVIDER))
                gps.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, INTERVALO_MS, DISTANCIA_M, this, Looper.getMainLooper());
        } catch (SecurityException e) {
            MainActivity.avisarEncerrado(); // sem permissão de localização
            stopSelf();
        }
    }

    @Override
    public void onLocationChanged(Location l) {
        // A rede (antena/Wi-Fi) é bem menos precisa: o núcleo descarta acima de 80 m.
        MainActivity.entregarPosicao(l.getLatitude(), l.getLongitude(), l.hasAccuracy() ? l.getAccuracy() : 999f);
    }

    @Override public void onStatusChanged(String p, int s, Bundle b) {}
    @Override public void onProviderEnabled(String p) {}
    @Override public void onProviderDisabled(String p) {}

    @Override
    public void onDestroy() {
        ativo = false;
        if (gps != null) gps.removeUpdates(this);
        stopForeground(true);
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent i) { return null; }
}
