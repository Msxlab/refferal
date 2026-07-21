import { Module } from "@nestjs/common";
import { NetworkHierarchyService } from "./network-hierarchy.service";

@Module({
  providers: [NetworkHierarchyService],
  exports: [NetworkHierarchyService],
})
export class NetworkHierarchyModule {}
