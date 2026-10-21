const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp();

exports.adminSetUserPassword = onCall(
  {
    region: 'southamerica-east1',
    cors: true
  },
  async (request) => {
    const actorUid = request.auth?.uid;
    if (!actorUid) {
      throw new HttpsError('unauthenticated', 'Entre novamente no EXRisco para continuar.');
    }

    const db = getFirestore();
    const actorSnap = await db.doc(`usuarios/${actorUid}`).get();
    const actor = actorSnap.exists ? actorSnap.data() : null;

    if (!actor || actor.ativo !== true || actor.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Somente administradores ativos podem alterar senhas.');
    }

    const uid = String(request.data?.uid || '').trim();
    const password = String(request.data?.password || '');

    if (!uid) {
      throw new HttpsError('invalid-argument', 'Usuário de destino não informado.');
    }

    if (password.length < 6) {
      throw new HttpsError('invalid-argument', 'A nova senha precisa ter pelo menos 6 caracteres.');
    }

    const targetSnap = await db.doc(`usuarios/${uid}`).get();
    if (!targetSnap.exists) {
      throw new HttpsError('not-found', 'O perfil do usuário não foi encontrado no EXRisco.');
    }

    try {
      await getAuth().updateUser(uid, { password });
      await getAuth().revokeRefreshTokens(uid);

      await db.collection('auditoria_acessos').add({
        acao: 'senha_alterada_por_admin',
        atorUid: actorUid,
        atorNome: actor.nome || request.auth.token.email || '',
        alvoUid: uid,
        alvoNome: targetSnap.data()?.nome || '',
        alvoEmail: targetSnap.data()?.email || '',
        criadoEm: FieldValue.serverTimestamp()
      });

      return { ok: true };
    } catch (error) {
      console.error('Falha ao alterar senha no Firebase Authentication.', {
        actorUid,
        targetUid: uid,
        code: error?.code || 'unknown'
      });

      if (error?.code === 'auth/user-not-found') {
        throw new HttpsError('not-found', 'A conta não existe mais no Firebase Authentication.');
      }

      if (error?.code === 'auth/invalid-password') {
        throw new HttpsError('invalid-argument', 'A senha informada não atende aos requisitos do Firebase.');
      }

      throw new HttpsError('internal', 'Não foi possível alterar a senha agora.');
    }
  }
);
