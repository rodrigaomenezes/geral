#!/usr/bin/env bash
# Gera o APK de piloto do Estadia BR sem Android Studio.
# Requer (Ubuntu): sudo apt-get install aapt dalvik-exchange apksigner zipalign android-sdk-platform-23 openjdk-17-jdk
# Uso: ./build.sh   →  dist/EstadiaBR-piloto.apk
set -euo pipefail
cd "$(dirname "$0")"
ANDROID_JAR=/usr/lib/android-sdk/platforms/android-23/android.jar
KEYSTORE=${ESTADIA_KEYSTORE:-$HOME/.estadia/estadia-piloto.jks}
KEYPASS=${ESTADIA_KEYPASS:-estadia-piloto}

rm -rf build dist && mkdir -p build/classes dist
# Chave de assinatura do piloto (fica fora do repositório). Em produção, usar a chave oficial guardada com segurança.
if [ ! -f "$KEYSTORE" ]; then
  mkdir -p "$(dirname "$KEYSTORE")"
  keytool -genkeypair -keystore "$KEYSTORE" -storepass "$KEYPASS" -keypass "$KEYPASS" -alias estadia \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Estadia BR, O=Estadia BR, C=BR" >/dev/null
fi

aapt package -f -M AndroidManifest.xml -S res -I "$ANDROID_JAR" -F build/base.apk
javac --release 8 -nowarn -Xlint:-options -cp "$ANDROID_JAR" -d build/classes $(find src -name '*.java')
dalvik-exchange --dex --min-sdk-version=24 --output=build/classes.dex build/classes
(cd build && aapt add base.apk classes.dex >/dev/null)
zipalign -f -p 4 build/base.apk build/aligned.apk
apksigner sign --ks "$KEYSTORE" --ks-pass "pass:$KEYPASS" --key-pass "pass:$KEYPASS" --out dist/EstadiaBR-piloto.apk build/aligned.apk
apksigner verify dist/EstadiaBR-piloto.apk
echo "APK: $(pwd)/dist/EstadiaBR-piloto.apk"
