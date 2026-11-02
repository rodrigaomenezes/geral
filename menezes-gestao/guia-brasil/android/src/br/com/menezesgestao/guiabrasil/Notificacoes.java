package br.com.menezesgestao.guiabrasil;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import java.lang.reflect.Constructor;

/**
 * Canais e notificações. O APK é compilado contra a API 23 (único android.jar disponível no build), então as APIs
 * de canal (Android 8+) são chamadas por reflexão. Ver decisão G-013.
 */
final class Notificacoes {
    static final String CANAL_CAMINHADA = "caminhada";   // aviso fixo do serviço: discreto
    static final String CANAL_IMPORTANTE = "importante"; // som e destaque
    static final String CANAL_AVISOS = "avisos";         // pontos, dicas e novidades
    static final int ID_SERVICO = 1;
    static final int FLAG_IMMUTABLE = 67108864; // PendingIntent.FLAG_IMMUTABLE (API 23)

    private Notificacoes() {}

    static void criarCanais(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        criarCanal(c, CANAL_CAMINHADA, "Caminhada em andamento", "Mostra que o GuIA está acompanhando o seu trajeto.", 2);
        criarCanal(c, CANAL_IMPORTANTE, "Avisos importantes", "Segurança e atenção no caminho.", 4);
        criarCanal(c, CANAL_AVISOS, "Pontos e dicas", "Pontos turísticos, dicas e novidades perto de você.", 3);
    }

    private static void criarCanal(Context c, String id, String nome, String descricao, int importancia) {
        try {
            Class<?> canal = Class.forName("android.app.NotificationChannel");
            Constructor<?> k = canal.getConstructor(String.class, CharSequence.class, int.class);
            Object ch = k.newInstance(id, nome, importancia);
            canal.getMethod("setDescription", String.class).invoke(ch, descricao);
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            NotificationManager.class.getMethod("createNotificationChannel", canal).invoke(nm, ch);
        } catch (Exception e) { /* sem canal o Android 8+ descarta a notificação; não há o que fazer além de seguir */ }
    }

    static Notification.Builder construtor(Context c, String canal) {
        if (Build.VERSION.SDK_INT >= 26) {
            try { return (Notification.Builder) Notification.Builder.class.getConstructor(Context.class, String.class).newInstance(c, canal); }
            catch (Exception e) { /* cai no construtor antigo */ }
        }
        return new Notification.Builder(c);
    }

    /** Abre o app no alerta tocado (o id vai para o JavaScript em guiaAbrirAlerta). */
    static PendingIntent abrirApp(Context c, String alertaId, int codigo) {
        Intent i = new Intent(c, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (alertaId != null) i.putExtra("alerta", alertaId);
        return PendingIntent.getActivity(c, codigo, i, PendingIntent.FLAG_UPDATE_CURRENT | FLAG_IMMUTABLE);
    }

    /** Aviso fixo enquanto a caminhada está ativa (obrigatório para o serviço em primeiro plano). */
    static Notification caminhada(Context c) {
        Intent parar = new Intent(c, GuiaServico.class).setAction(GuiaServico.ACAO_PARAR);
        PendingIntent pParar = PendingIntent.getService(c, 2, parar, PendingIntent.FLAG_UPDATE_CURRENT | FLAG_IMMUTABLE);
        return construtor(c, CANAL_CAMINHADA)
            .setSmallIcon(R.drawable.ic_notificacao)
            .setContentTitle("GuIA Brasil está caminhando com você")
            .setContentText("Você recebe os avisos que escolheu, mesmo com a tela bloqueada.")
            .setContentIntent(abrirApp(c, null, 1))
            .setOngoing(true)
            .addAction(0, "Encerrar caminhada", pParar)
            .build();
    }

    /** Notificação de um alerta do companheiro. O mesmo id substitui a anterior (não empilha repetidas). */
    static void alerta(Context c, String id, String tipo, String titulo, String texto) {
        boolean importante = "importante".equals(tipo);
        Notification.Builder b = construtor(c, importante ? CANAL_IMPORTANTE : CANAL_AVISOS)
            .setSmallIcon(R.drawable.ic_notificacao)
            .setContentTitle(titulo)
            .setContentText(texto)
            .setStyle(new Notification.BigTextStyle().bigText(texto))
            .setAutoCancel(true)
            .setContentIntent(abrirApp(c, id, 100 + Math.abs(id.hashCode() % 10000)))
            .setPriority(importante ? Notification.PRIORITY_HIGH : Notification.PRIORITY_DEFAULT)
            .setVibrate(importante ? new long[] { 0, 200, 100, 200, 100, 200 } : new long[] { 0, 120 });
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        nm.notify("alerta-" + id, 7, b.build());
    }
}
