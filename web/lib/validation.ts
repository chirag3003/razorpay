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

/* -------------------------------------------------------------------------- */
/* admin                                                                      */
/* -------------------------------------------------------------------------- */

export const adminLoginSchema = z.object({
  password: z.string().min(1, "Enter the admin password"),
});

export type AdminLoginFormValues = z.infer<typeof adminLoginSchema>;

export const adminProductSchema = z
  .object({
    name: z.string().min(2, "Enter a product name"),
    categorySlug: z.string().min(1, "Pick a category"),
    // Inputs of type="number" hand back strings, and there's no
    // valueAsNumber escape hatch when the field goes through Controller.
    price: z.coerce
      .number<number>()
      .int("Price must be a whole rupee amount")
      .positive("Enter a price"),
    mrp: z.coerce
      .number<number>()
      .int("MRP must be a whole rupee amount")
      .positive("Enter an MRP"),
    unit: z.string().min(1, "Enter a unit, e.g. 500 g"),
    image: z.url("Enter a valid image URL"),
    description: z.string().min(10, "Enter a description"),
    images: z.string().optional(),
    tags: z.string().optional(),
    inStock: z.boolean(),
  })
  .refine((data) => data.mrp >= data.price, {
    message: "MRP must be at least the selling price",
    path: ["mrp"],
  });

export type AdminProductFormValues = z.infer<typeof adminProductSchema>;

export const adminCategorySchema = z.object({
  name: z.string().min(2, "Enter a category name"),
  slug: z.string().optional(),
  description: z.string().min(5, "Enter a description"),
  icon: z.string().min(1, "Pick an icon"),
  image: z.url("Enter a valid image URL"),
});

export type AdminCategoryFormValues = z.infer<typeof adminCategorySchema>;
