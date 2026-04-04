import { db } from '../firebase-config.js';

/**
 * Solicita permissão do navegador para exibir notificações do sistema
 */
export async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    console.warn('Este navegador não suporta notificações de desktop.');
    return false;
  }
  
  if (Notification.permission === 'granted') {
    return true;
  }

  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }

  return false;
}

/**
 * Cria uma nova notificação direta para um usuário
 */
export async function createNotification(userId, data) {
  if (!db) {
    console.warn('Modo demo ativado. Notificações não são suportadas em modo demo.');
    return null;
  }

  try {
    const docRef = await db.collection('notifications').add({
      userId,
      title: data.title || 'Nova Notificação',
      body: data.body || '',
      type: data.type || 'info', // 'transaction', 'budget', 'info'
      createdAt: new Date(),
      isRead: false,
      data: data.data || {} // Ex: { transactionId: 'xyz' }
    });
    return docRef.id;
  } catch (error) {
    console.error('Erro ao criar notificação:', error);
    return null;
  }
}

/**
 * Notifica o parceiro passivo de uma atividade (membros da família exceto o próprio usuário)
 */
export async function notifyPartner(familyId, currentUserId, data) {
  if (!db || !familyId) return;

  try {
    // Buscar todos os usuários dessa família
    const usersSnap = await db.collection('users').where('familyId', '==', familyId).get();
    
    usersSnap.forEach(doc => {
      if (doc.id !== currentUserId) {
        // Envia notificação apenas para os OUTROS membros
        createNotification(doc.id, data);
      }
    });
  } catch (error) {
    console.error('Erro ao notificar parceiros:', error);
  }
}

/**
 * Escuta notificações em tempo real para um usuário específico
 */
export function listenNotifications(userId, callback) {
  if (!db) return () => {};

  return db.collection('notifications')
    .where('userId', '==', userId)
    .orderBy('createdAt', 'desc')
    .limit(50) // Limitar histórico
    .onSnapshot(
      (snapshot) => {
        const notifications = [];
        let hasNewUnread = false;

        snapshot.forEach(doc => {
          const notif = { id: doc.id, ...doc.data() };
          notifications.push(notif);
        });

        // Procurar por changes specifically for system notification
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'added') {
            const notif = change.doc.data();
            // Apenas lança notificação de desktop se a notificação foi adicionada AGORA
            // (evita flood ao recarregar a página)
            const createdAt = notif.createdAt?.toDate ? notif.createdAt.toDate() : new Date();
            const ageEmSegundos = (new Date() - createdAt) / 1000;
            
            if (ageEmSegundos < 10 && !notif.isRead) {
               showSystemNotification(notif.title, notif.body);
               hasNewUnread = true;
            }
          }
        });

        callback(notifications, hasNewUnread);
      },
      (error) => {
        console.error('Erro ao escutar notificações:', error);
      }
    );
}

/**
 * Marca uma ou todas notificações como lidas
 */
export async function markAsRead(notificationId = null, userId = null) {
  if (!db) return;

  try {
    if (notificationId) {
      await db.collection('notifications').doc(notificationId).update({ isRead: true });
    } else if (userId) {
      // Marcar todas desse usuário como lidas
      const unreadSnap = await db.collection('notifications')
        .where('userId', '==', userId)
        .where('isRead', '==', false)
        .get();
      
      const batch = db.batch();
      unreadSnap.forEach(doc => {
        batch.update(doc.ref, { isRead: true });
      });
      await batch.commit();
    }
  } catch (error) {
    console.error('Erro ao marcar notificações como lidas:', error);
  }
}

/**
 * Exibe a notificação de sistema (Toast do SO) se houver permissão
 */
function showSystemNotification(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, {
      body,
      icon: '/icon-192.png' // Assumindo que esse arquivo exista de acordo com o manifest.json
    });
  }
}
