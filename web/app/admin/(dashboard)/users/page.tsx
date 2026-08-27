"use client";

import { useState } from "react";
import Link from "next/link";
import { Users as UsersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminSearchInput } from "@/components/admin/admin-search-input";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { AdminTableState } from "@/components/admin/admin-table-state";
import { useAdminList } from "@/hooks/use-admin-list";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { getAdminUsers } from "@/lib/api/admin";
import { ADMIN_USERS_PAGE_SIZE } from "@/lib/admin-constants";
import { formatDate, initials } from "@/lib/admin-format";

export default function AdminUsersPage() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const debouncedQuery = useDebouncedValue(query);

  const { items, total, loading, failed, reload } = useAdminList(
    getAdminUsers,
    { q: debouncedQuery, page, pageSize: ADMIN_USERS_PAGE_SIZE }
  );

  function handleSearch(value: string) {
    setQuery(value);
    setPage(1);
  }

  return (
    <div>
      <AdminPageHeader
        title="Users"
        description={`${total} registered ${total === 1 ? "customer" : "customers"}`}
      />

      <div className="mb-4">
        <AdminSearchInput
          value={query}
          onChange={handleSearch}
          placeholder="Search name or email…"
          className="sm:max-w-xs"
        />
      </div>

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="text-right">Orders</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <AdminTableState
              colSpan={5}
              loading={loading}
              failed={failed}
              isEmpty={items.length === 0}
              onRetry={reload}
              emptyIcon={UsersIcon}
              emptyTitle="No users found"
              emptyDescription={
                debouncedQuery
                  ? "No customer matches that name or email."
                  : "Customers will appear here once they sign up."
              }
            />
            {!loading &&
              !failed &&
              items.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <Avatar className="size-8">
                        <AvatarFallback className="text-xs">
                          {initials(user.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="font-medium">{user.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {user.email}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {user.phone}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(user.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      nativeButton={false}
                      render={<Link href={`/admin/orders?userId=${user.id}`} />}
                    >
                      View orders
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
        <AdminPagination
          page={page}
          pageSize={ADMIN_USERS_PAGE_SIZE}
          total={total}
          onPageChange={setPage}
        />
      </Card>
    </div>
  );
}
