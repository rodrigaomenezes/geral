#!/usr/bin/env bash
# Gera o APK de piloto do GuIA Brasil sem Android Studio (mesmo caminho do app do Estadia).
# Requer (Ubuntu): sudo apt-get install aapt dalvik-exchange apksigner zipalign android-sdk-platform-23 openjdk-17-jdk
# Uso: ./build.sh   →  dist/GuIA-Brasil-piloto.apk
# Chave: GUIA_KEYSTORE / GUIA_KEYPASS (variáveis de ambiente). Sem elas, cria uma chave de piloto fora do repositório.
# Use sempre a MESMA chave: o Android só atualiza o app por cima se a assinatura for igual.
set -euo pipefail
cd "$(dirname "$0")"
ANDROID_JAR=/usr/lib/android-sdk/platforms/android-23/android.jar
KEYSTORE=${GUIA_KEYSTORE:-$HOME/.guia-brasil/guia-piloto.jks}
KEYPASS=${GUIA_KEYPASS:-guia-piloto}

rm -rf build dist && mkdir -p build/classes build/gen dist
if [ ! -f "$KEYSTORE" ]; then
  mkdir -p "$(dirname "$KEYSTORE")"
  keytool -genkeypair -keystore "$KEYSTORE" -storepass "$KEYPASS" -keypass "$KEYPASS" -alias guia \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=GuIA Brasil, O=Menezes Gestao, C=BR" >/dev/null
fi

# Recursos (gera R.java para o ícone da notificação) e pacote base
aapt package -f -m -J build/gen -M AndroidManifest.xml -S res -I "$ANDROID_JAR" -F build/base.apk
javac --release 8 -nowarn -Xlint:-options -cp "$ANDROID_JAR" -d build/classes $(find src build/gen -name '*.java')
dalvik-exchange --dex --min-sdk-version=24 --output=build/classes.dex build/classes
(cd build && aapt add base.apk classes.dex >/dev/null)
zipalign -f -p 4 build/base.apk build/aligned.apk
apksigner sign --ks "$KEYSTORE" --ks-pass "pass:$KEYPASS" --key-pass "pass:$KEYPASS" --out dist/GuIA-Brasil-piloto.apk build/aligned.apk
apksigner verify dist/GuIA-Brasil-piloto.apk
echo "APK: $(pwd)/dist/GuIA-Brasil-piloto.apk"
