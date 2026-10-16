package br.com.estadia.app;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.telephony.SmsManager;
import android.telephony.SmsMessage;

/** Recebe da operadora o aviso de SMS enviado e entregue e repassa ao app aberto. */
public class SmsRetorno extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent i) {
        String id = i.getStringExtra("id"), etapa = i.getStringExtra("etapa");
        if (id == null || etapa == null) return;
        String status = etapa, erro = null;
        if ("enviado".equals(etapa) && getResultCode() != Activity.RESULT_OK) {
            status = "falha";
            int c = getResultCode();
            erro = c == SmsManager.RESULT_ERROR_NO_SERVICE ? "sem sinal de celular" : c == SmsManager.RESULT_ERROR_RADIO_OFF ? "celular em modo avião" : "a operadora recusou o envio";
        }
        if ("entregue".equals(etapa)) {
            // Relatório de entrega (GSM): 0x00–0x1F entregue; 0x20–0x3F ainda tentando; 0x40+ falhou.
            try {
                byte[] pdu = i.getByteArrayExtra("pdu");
                if (pdu != null) {
                    int st = SmsMessage.createFromPdu(pdu, i.getStringExtra("format")).getStatus();
                    if (st >= 0x40) { status = "falha"; erro = "a operadora não conseguiu entregar"; }
                    else if (st >= 0x20) return;
                }
            } catch (Exception e) { /* sem detalhe: considera entregue */ }
        }
        MainActivity a = MainActivity.atual;
        if (a != null) a.avisarWeb(id, status, erro);
        else MainActivity.guardar(ctx, id, status, erro); // app fechado: avisa quando abrir de novo
    }
}
