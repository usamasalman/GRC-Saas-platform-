import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';

/**
 * A user's own inbox. Deliberately not tenant-scoped through the resolver —
 * notifications are addressed to a person, and nobody may read another's,
 * including a group-level role that can otherwise see the whole subtree.
 */
export const listNotifications = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { unread } = req.query as Record<string, string | undefined>;
    const where: any = { recipientId: req.user!.id };
    if (unread === 'true') where.readAt = null;

    const notifications = await prisma.notification.findMany({
      where,
      orderBy: [{ readAt: 'asc' }, { createdAt: 'desc' }],
      take: 100,
    });

    res.json({
      status: 'success',
      count: notifications.length,
      unread: notifications.filter((n) => n.readAt === null).length,
      notifications,
    });
  } catch (error: any) {
    console.error('[Notification List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load notifications' });
  }
};

/** Cheap enough for the UI to poll for a badge count. */
export const unreadCount = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const unread = await prisma.notification.count({
      where: { recipientId: req.user!.id, readAt: null },
    });
    res.json({ status: 'success', unread });
  } catch (error: any) {
    console.error('[Notification Count Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to count notifications' });
  }
};

export const markRead = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    // Scoped by recipient so one user can never mark another's inbox read.
    const result = await prisma.notification.updateMany({
      where: { id, recipientId: req.user!.id, readAt: null },
      data: { readAt: new Date() },
    });
    if (result.count === 0) {
      res.status(404).json({ status: 'error', message: 'Notification not found, or already read' });
      return;
    }
    res.json({ status: 'success', message: 'Marked as read' });
  } catch (error: any) {
    console.error('[Notification Read Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to mark notification read' });
  }
};

export const markAllRead = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const result = await prisma.notification.updateMany({
      where: { recipientId: req.user!.id, readAt: null },
      data: { readAt: new Date() },
    });
    res.json({ status: 'success', message: `${result.count} notification(s) marked as read`, count: result.count });
  } catch (error: any) {
    console.error('[Notification ReadAll Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to mark notifications read' });
  }
};
