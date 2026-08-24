import { z } from "zod";

export const addressSchema = z.object({
  type: z.enum(["Home", "Work", "Other"]),
  name: z.string().min(2, "Enter the recipient's name"),
  phone: z
    .string()
    .min(10, "Enter a valid phone number")
    .max(15, "Enter a valid phone number"),
  line1: z.string().min(5, "Enter your address"),
  line2: z.string().optional(),
  city: z.string().min(2, "Enter a city"),
  state: z.string().min(2, "Enter a state"),
  pincode: z
    .string()
    .min(6, "Enter a valid 6-digit pincode")
    .max(6, "Enter a valid 6-digit pincode"),
});

export type AddressFormValues = z.infer<typeof addressSchema>;

export const loginSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export type LoginFormValues = z.infer<typeof loginSchema>;

export const signupSchema = z
  .object({
    name: z.string().min(2, "Enter your full name"),
    email: z.email("Enter a valid email address"),
    phone: z
      .string()
      .min(10, "Enter a valid phone number")
      .max(15, "Enter a valid phone number"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type SignupFormValues = z.infer<typeof signupSchema>;

export const profileSchema = z.object({
  name: z.string().min(2, "Enter your full name"),
  email: z.email("Enter a valid email address"),
  phone: z
    .string()
    .min(10, "Enter a valid phone number")
    .max(15, "Enter a valid phone number"),
});

export type ProfileFormValues = z.infer<typeof profileSchema>;
