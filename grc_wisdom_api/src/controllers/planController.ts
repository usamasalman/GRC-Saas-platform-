import { Request, Response } from 'express';

// Mock DB for plans until Prisma Client is generated
const mockPlans = [
  { id: 'p1', name: 'Essentials', priceMonthly: 1500, maxUsers: 50 },
  { id: 'p2', name: 'Professional', priceMonthly: 4500, maxUsers: 250 },
  { id: 'p3', name: 'Enterprise', priceMonthly: 12000, maxUsers: 1000 }
];

export const getPlans = async (req: Request, res: Response): Promise<void> => {
  try {
    // In a real scenario, this would query the DB using Prisma
    // const plans = await prisma.plan.findMany();
    res.status(200).json({
      status: 'success',
      data: mockPlans
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const createPlan = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, priceMonthly, maxUsers, features } = req.body;
    
    // Validation would happen here
    const newPlan = {
      id: `p${mockPlans.length + 1}`,
      name,
      priceMonthly,
      maxUsers,
      features
    };
    
    res.status(201).json({
      status: 'success',
      data: newPlan
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};
