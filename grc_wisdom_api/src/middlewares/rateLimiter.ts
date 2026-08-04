import { Request, Response, NextFunction } from 'express';

// Simple in-memory rate limiter mock for public APIs
// In production, use Redis and `express-rate-limit`
const requestCounts = new Map<string, { count: number, resetTime: number }>();

export const rateLimiter = (req: Request, res: Response, next: NextFunction): void => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const apiKey = req.headers['x-api-key'] as string || ip; // Group by API Key or IP
  
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute window
  const limit = 60; // 60 requests per minute
  
  let record = requestCounts.get(apiKey);
  
  if (!record || record.resetTime < now) {
    record = { count: 1, resetTime: now + windowMs };
  } else {
    record.count++;
  }
  
  requestCounts.set(apiKey, record);
  
  // Set headers
  res.setHeader('X-RateLimit-Limit', limit);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - record.count));
  
  if (record.count > limit) {
    res.status(429).json({ 
      status: 'error', 
      message: 'Too Many Requests. Please slow down.' 
    });
    return;
  }
  
  next();
};
