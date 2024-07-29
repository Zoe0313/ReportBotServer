#!/usr/bin/env python

# Copyright 2023 VMware, Inc.  All rights reserved. -- VMware Confidential

'''
Module docstring.  
RefreshNannyList.py
'''

from generator.src.nanny.RefreshNannysOnWiki import RefreshVSanNannyList
from generator.src.nanny.RefreshNannysOnPage import RefreshNannysOnPage

if __name__ == "__main__":
    RefreshVSanNannyList()
    # RefreshNannysOnPage()
